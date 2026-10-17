export type ImageSource=File|string;
const raster=/^image\/(png|jpe?g|webp|gif|avif|bmp|tiff|heic|heif)$/i;
export function canTransferImages(data:DataTransfer){return Array.from(data.types).some(type=>['Files','text/html','text/uri-list','text/plain','text/x-moz-url'].includes(type))}
/** Read synchronously: browsers discard the transfer's contents after the event. */
export function transferredImages(data:DataTransfer):ImageSource[]{
 const files=Array.from(data.files).filter(file=>file.type.startsWith('image/'));
 if(files.length)return files;
 const sources:string[]=[];
 const add=(value:string)=>{try{const url=new URL(value.trim());if(['https:','http:'].includes(url.protocol)||(/^data:image\/(png|jpeg|webp|gif|avif|bmp);base64,/i.test(value)&&value.length<49*1024*1024))sources.push(url.href)}catch{}};
 // A detached template is inert: never insert imported HTML into the document.
 const html=data.getData('text/html');
 if(html&&html.length<1024*1024){const template=document.createElement('template');template.innerHTML=html;template.content.querySelectorAll('img').forEach(image=>add(image.getAttribute('src')||''))}
 if(!sources.length){const text=data.getData('text/uri-list')||data.getData('text/x-moz-url')||data.getData('text/plain');for(const line of text.split(/\r?\n/)){if(!line.startsWith('#'))add(line)}}
 return [...new Set(sources)];
}
export async function imageSourceFile(source:ImageSource):Promise<File>{
 if(typeof source!=='string')return source;
 if(source.startsWith('data:')){const [header,encoded]=source.split(',',2),type=header.slice(5).split(';')[0];if(!raster.test(type))throw new Error('Choose an image file.');const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));return new File([bytes],'pasted-image',{type})}
 const response=await fetch('/api/photos/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:source})});
 if(!response.ok){if(response.status===401)window.dispatchEvent(new Event('album-session-expired'));const error=await response.json().catch(()=>({}));throw new Error(error.error||'Couldn’t copy this image. Try Copy image or save it first.')}
 const blob=await response.blob();return new File([blob],'web-image',{type:blob.type});
}
