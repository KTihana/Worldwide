self.onmessage=async(event:MessageEvent<{id:number;file:File}>)=>{
 const {id,file}=event.data;
 try{const bitmap=await createImageBitmap(file),scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));const canvas=new OffscreenCanvas(Math.round(bitmap.width*scale),Math.round(bitmap.height*scale));const context=canvas.getContext('2d');if(!context)throw new Error('Could not prepare photo.');context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const blob=await canvas.convertToBlob({type:'image/webp',quality:.88});self.postMessage({id,blob});}catch(error){self.postMessage({id,error:(error as Error).message})}
};
