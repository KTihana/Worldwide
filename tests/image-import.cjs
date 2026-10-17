const {app,BrowserWindow,clipboard,ClipboardItem}=require('electron');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {resolve,join}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'..'),temp=mkdtempSync(join(tmpdir(),'worldwide-image-import-')),base='http://127.0.0.1:3381';
const png='iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAPUlEQVRIie3VQQ0AMAwCwEnHBhZQORnb45L+mzSUO1mfzLF4Th3hqneaAonKLCSGxWJxWAwWi8VhMV+xeAFmz0KJ5NNL3gAAAABJRU5ErkJggg==';
const pause=ms=>new Promise(r=>setTimeout(r,ms));let server,win,outcome=0;
const js=code=>win.webContents.executeJavaScript(code,true);
async function until(fn,label){for(let i=0;i<150;i++){if(await fn())return;await pause(100)}throw new Error('Timed out: '+label+' '+await js('document.body.innerText'))}
app.whenReady().then(async()=>{try{
 server=spawn(process.env.WORLDWIDE_NODE||'/opt/homebrew/bin/node',['server/index.ts'],{cwd:root,env:{...process.env,PORT:'3381',ELSEWHERE_DATA_DIR:temp,ELSEWHERE_TLS_CERT:'',ELSEWHERE_TLS_KEY:''},stdio:'ignore'});
 await until(async()=>{try{return(await fetch(base+'/api/health')).ok}catch{return false}},'server');
 const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'paste@example.test',password:'private paste test password'})});assert.equal(setup.status,200);const [name,...value]=setup.headers.get('set-cookie').split(';')[0].split('=');
 win=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});await win.webContents.session.cookies.set({url:base,name,value:value.join('=')});
 await win.loadURL(base);await until(()=>js(`document.querySelectorAll('[data-country]').length>200`),'map');
 // Dropping an image directly onto the map opens and saves it in that country.
 await js(`(()=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0))],'drop.png',{type:'image/png'}));document.querySelector('[data-country="HRV"]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}))})()`);
 await until(()=>js(`document.querySelectorAll('[data-photo-id]').length===1&&!document.querySelector('.upload-button').disabled`),'file drop saved');
 // Real Electron Paste command with a system clipboard image, as after Copy image.
 await clipboard.write([new ClipboardItem({'image/png':new Blob([Buffer.from(png,'base64')],{type:'image/png'})})]);await js(`document.querySelector('.upload-button').focus()`);win.webContents.paste();
 await until(()=>js(`document.querySelectorAll('[data-photo-id]').length===2&&!document.querySelector('.upload-button').disabled`),'clipboard image saved');
 // HTML drags contain both a linked page and an image: import the image once.
 await js(`(()=>{window.imported=[];const original=window.fetch;window.fetch=async(input,options)=>{if(input==='/api/photos/import'){window.imported.push(JSON.parse(options.body).url);return new Response(Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}})}return original(input,options)};const dt=new DataTransfer();dt.setData('text/html','<a href="https://example.com/page"><img src="https://images.example.com/photo.png"></a>');dt.setData('text/uri-list','https://example.com/page');document.querySelector('.country-panel').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}))})()`);
 await until(()=>js(`document.querySelectorAll('[data-photo-id]').length===3&&!document.querySelector('.upload-button').disabled`),'web image saved');assert.deepEqual(await js(`window.imported`),['https://images.example.com/photo.png']);
 // Typing in notes still pastes text normally, never uploads a link by accident.
 assert.equal(await js(`(()=>{const el=document.querySelector('textarea');const dt=new DataTransfer();dt.setData('text/plain','https://example.com/notes');const e=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt});el.dispatchEvent(e);return e.defaultPrevented})()`),false);
 assert.equal(await js(`(()=>{const el=document.querySelector('textarea'),dt=new DataTransfer();dt.setData('text/plain','https://example.com/notes');const e=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt});el.dispatchEvent(e);return e.defaultPrevented})()`),false,'Dropping links into notes keeps native text editing');
 // Other dialogs must not import photos into the album behind them.
 await js(`(()=>{const modal=document.createElement('div');modal.className='modal-backdrop export-map-modal';document.body.append(modal);const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0))],'blocked.png',{type:'image/png'}));modal.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));modal.remove()})()`);await pause(150);assert.equal(await js(`document.querySelectorAll('[data-photo-id]').length`),3);
 // Duplicate paste while a photo is preparing must not start a second upload.
 await js(`(()=>{for(let i=0;i<2;i++){const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0))],'paste.png',{type:'image/png'}));document.querySelector('.country-panel').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}))}})()`);
 await until(()=>js(`document.querySelectorAll('[data-photo-id]').length===4&&!document.querySelector('.upload-button').disabled`),'one upload at a time');await pause(300);assert.equal(await js(`document.querySelectorAll('[data-photo-id]').length`),4);
 await win.reload();await until(()=>js(`document.querySelectorAll('[data-country]').length>200`),'reload');
 const atlas=await win.webContents.executeJavaScript(`fetch('/api/atlas').then(r=>r.json())`);assert.equal(atlas.photos.length,4,'Imported images persist across app reload');
 console.log('PASS: drop onto country, real clipboard image paste, HTML image URL priority, notes paste, upload lock, saved photo reload.');
 }catch(error){console.error(error);outcome=1}finally{win?.destroy();server?.kill();await pause(300);rmSync(temp,{recursive:true,force:true});app.exit(outcome)}});
