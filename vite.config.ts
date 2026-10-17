import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
 plugins:[react()],build:{outDir:'dist'},
 server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':{
  target:'http://127.0.0.1:3000',changeOrigin:true,
  configure(proxy){proxy.on('proxyReq',(proxyRequest,request)=>{if(['http://127.0.0.1:5173','http://localhost:5173'].includes(request.headers.origin||''))proxyRequest.setHeader('origin','http://127.0.0.1:3000')})},
 }}},
});
