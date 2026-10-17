const {contextBridge,ipcRenderer}=require('electron');
async function invoke(channel){const reply=await ipcRenderer.invoke(channel);if(reply.error)throw new Error(reply.error);return reply.value}
contextBridge.exposeInMainWorld('WorldwideDesktop',{
 checkUpdate:()=>invoke('worldwide:check-update'),
 installUpdate:()=>invoke('worldwide:install-update'),
 onUpdateProgress:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('worldwide:update-progress',listener);return()=>ipcRenderer.removeListener('worldwide:update-progress',listener)},
});
