package app.worldwide;

import android.app.Instrumentation;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.WebView;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;

/** Real offline mutations and optional two-way sync, only in a disposable package. */
final class StandaloneSmokeTests {
    private static final byte[] IMAGE=Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9WQAAAAASUVORK5CYII=",Base64.DEFAULT);
    private static Instrumentation test;
    private static MainActivity activity;
    private static SharedPreferences prefs;
    private static Method api;
    private static Field generation;
    static void run(Instrumentation instrumentation,Bundle args)throws Exception {
        test=instrumentation;
        check("app.worldwide.nativetest".equals(test.getTargetContext().getPackageName()),"Standalone test must use its disposable package");
        prefs=test.getTargetContext().getSharedPreferences("worldwide",0);prefs.edit().clear().commit();
        migration();
        api=MainActivity.class.getDeclaredMethod("api",String.class,String.class,JSONObject.class,byte[].class,int.class,boolean.class);api.setAccessible(true);
        generation=MainActivity.class.getDeclaredField("generation");generation.setAccessible(true);
        try {
            launch();
            JSONObject session=json(call("/api/auth/session","GET",null));
            check(session.optBoolean("localOnly"),"A fresh phone opens without a computer or account");
            waitUi("document.querySelectorAll('[data-country]').length>200","Standalone map opens without pairing");
            js("document.querySelector('[aria-label=\"Your account\"]').click();true");
            waitUi("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Connect computer')","Computer connection is optional");
            js("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Connect computer').click();true");
            waitUi("!!document.querySelector('.connection-screen')","Optional connection opens upright");
            js("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Keep using this phone').click();true");
            waitUi("document.querySelectorAll('[data-country]').length>200","Connection can be skipped without an account");
            patch("/api/countries/HRV",new JSONObject().put("visited",true).put("note","Created on phone before connecting"));
            String first=upload("HRV","Phone memory");
            patch("/api/photos/"+first,new JSONObject().put("caption","Cropped on phone").put("cropX",.4).put("cropY",-.2).put("cropZoom",1.5));
            patch("/api/countries/HRV",new JSONObject().put("coverId",first));
            patch("/api/preferences",new JSONObject().put("mapStyle","robinson"));
            check(Arrays.equals(IMAGE,bytes(call("/api/photos/"+first,"GET",null))),"Unpaired photos are stored on the phone");
            restart();
            check(find(json(call("/api/atlas","GET",null)).getJSONArray("photos"),"id",first).getDouble("cropZoom")==1.5,"Photo edits survive an app restart without a connection");
            String link=decode(args.getString("qrPng"));
            check(link.contains("#worldwide-pair="),"Use the exact browser QR displayed by the PC");
            Method pair=MainActivity.class.getDeclaredMethod("pair",String.class,int.class);pair.setAccessible(true);
            pair.invoke(activity,link,generation.getInt(activity));
            waitSync();
            JSONObject merged=json(call("/api/atlas","GET",null));
            check(merged.getJSONArray("photos").length()==2,"Pairing combines existing PC and phone photos");
            check(find(merged.getJSONArray("visits"),"countryId","ITA").getString("note").equals("Created on PC before phone sync"),"Existing PC edit reaches the phone");
            check(find(merged.getJSONArray("photos"),"id",first).getDouble("cropZoom")==1.5,"First sync preserves local crops");
            String origin=args.getString("server"),cookie=prefs.getString("cookie","");
            check(remote(origin,cookie,"/api/atlas","GET",null).toString().contains(first),"Phone's original stable photo ID reaches the PC");
            prefs.edit().putString("server","http://127.0.0.1:1").commit();
            String second=upload("JPN","Added without Wi-Fi");
            patch("/api/photos/"+first,new JSONObject().put("caption","Edited while disconnected"));
            patch("/api/countries/HRV",new JSONObject().put("visited",false));
            check(json(call("/api/local-status","GET",null)).getInt("pending")>0,"Offline changes have a durable pending queue");
            check(!remote(origin,cookie,"/api/atlas","GET",null).toString().contains(second),"Unreachable sync does not masquerade as completed");
            remote(origin,cookie,"/api/countries/HRV","PATCH",new JSONObject().put("note","Edited on PC while phone was offline"));
            restart();
            check(find(json(call("/api/atlas","GET",null)).getJSONArray("photos"),"id",second)!=null,"Offline upload survives restart");
            check(json(call("/api/local-status","GET",null)).getInt("pending")>0,"Pending sync survives restart");
            js("Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});window.dispatchEvent(new Event('offline'));true");
            js("(()=>{const input=document.querySelector('[aria-label=\"Search countries\"]');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Croatia');input.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
            waitUi("[...document.querySelectorAll('.search-country')].some(b=>b.textContent.includes('Croatia'))","Search stays available offline");
            js("[...document.querySelectorAll('.search-country')].find(b=>b.textContent.includes('Croatia')).click();true");
            waitUi("!!document.querySelector('.country-modal')","Country opens offline");
            check("true".equals(js("!document.querySelector('.upload-button').disabled&&!document.querySelector('input[aria-label=\"Visited\"]').disabled")),"Offline UI allows photo uploads and visit edits");
            prefs.edit().putString("server",origin).commit();
            call("/api/local-sync","POST",new JSONObject());waitSync();
            JSONObject pc=remote(origin,cookie,"/api/atlas","GET",null),local=json(call("/api/atlas","GET",null));
            check(pc.getJSONArray("photos").length()==3&&local.getJSONArray("photos").length()==3,"Reconnect syncs exactly once without duplicate photos");
            check(find(pc.getJSONArray("photos"),"id",first).getString("caption").equals("Edited while disconnected"),"Offline phone caption reaches PC");
            JSONObject visit=find(local.getJSONArray("visits"),"countryId","HRV");
            check(visit.getInt("visited")==0&&visit.getString("note").equals("Edited on PC while phone was offline"),"Changes to different fields on each device are both retained");
            for(int i=0;i<2;i++){call("/api/local-sync","POST",new JSONObject());waitSync();}
            check(remote(origin,cookie,"/api/atlas","GET",null).getJSONArray("photos").length()==3,"Repeated synchronization is idempotent");
            call("/api/auth/logout","POST",new JSONObject());
            check(json(call("/api/auth/session","GET",null)).optBoolean("localOnly"),"Disconnect returns to standalone mode");
            check(json(call("/api/atlas","GET",null)).getJSONArray("photos").length()==3,"Disconnect keeps the device album");
            check(Arrays.equals(IMAGE,bytes(call("/api/photos/"+second,"GET",null))),"Disconnect keeps original photo bytes");
            try{pair.invoke(activity,decode(args.getString("otherQrPng")),generation.getInt(activity));throw new AssertionError("A different account must not silently receive this album");}
            catch(java.lang.reflect.InvocationTargetException expected){}
            check(json(call("/api/atlas","GET",null)).getJSONArray("photos").length()==3,"Rejected cross-account pairing preserves the device album");
            System.out.println("Standalone native album and optional sync passed");
        } finally {if(activity!=null)test.runOnMainSync(activity::finish);}
    }
    private static void migration()throws Exception{
        java.io.File folder=new java.io.File(test.getTargetContext().getCacheDir(),"legacy-album-test");folder.mkdirs();
        String id="a73882ee-0188-4b88-95fe-d6ab6a3f3211",key=LocalAlbum.key("/api/photos/"+id);
        JSONObject photo=new JSONObject().put("id",id).put("countryId","HRV").put("caption","Old memory").put("createdAt","2026-01-01T00:00:00Z").put("width",1).put("height",1).put("cropX",.2).put("cropY",0).put("cropZoom",2);
        JSONObject visit=new JSONObject().put("countryId","HRV").put("visited",1).put("coverId",id).put("note","Keep this note").put("visitDate",JSONObject.NULL).put("updatedAt","2026-01-01T00:00:00Z");
        JSONObject atlas=new JSONObject().put("photos",new JSONArray().put(photo)).put("visits",new JSONArray().put(visit)).put("mapStyle","robinson");
        java.nio.file.Files.write(new java.io.File(folder,"atlas.json").toPath(),atlas.toString().getBytes(StandardCharsets.UTF_8));
        java.nio.file.Files.write(new java.io.File(folder,key+".photo").toPath(),IMAGE);java.nio.file.Files.write(new java.io.File(folder,key+".mime").toPath(),"image/png".getBytes(StandardCharsets.UTF_8));
        LocalAlbum migrated=new LocalAlbum(folder,true,new java.util.HashSet<>(Arrays.asList("HRV","ITA","JPN")));
        try{
            check(migrated.pending()==0,"Linked legacy caches are not reuploaded");
            check(migrated.atlas().getJSONArray("photos").getJSONObject(0).getDouble("cropZoom")==2,"Legacy photo crop survives migration");
            check(Arrays.equals(IMAGE,migrated.photo(id).bytes),"Legacy original photo bytes survive migration");
            migrated.request("/api/countries/HRV","PATCH",new JSONObject(),"{\"note\":\"Edited after upgrade\"}".getBytes(StandardCharsets.UTF_8));
        }finally{migrated.close();}
        migrated=new LocalAlbum(folder,true,new java.util.HashSet<>(Arrays.asList("HRV","ITA","JPN")));
        try{check(migrated.pending()==1&&migrated.atlas().getJSONArray("visits").getJSONObject(0).getString("note").equals("Edited after upgrade"),"Upgraded album edits and queue persist across reopening");}finally{migrated.close();}
        remove(folder);
    }
    private static void remove(java.io.File file){java.io.File[] children=file.listFiles();if(children!=null)for(java.io.File child:children)remove(child);file.delete();}
    private static void launch(){activity=(MainActivity)test.startActivitySync(new Intent(test.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}
    private static void restart()throws Exception{test.runOnMainSync(activity::finish);test.waitForIdleSync();Thread.sleep(150);launch();waitUi("document.querySelectorAll('[data-country]').length>200","Reopened local map");}
    private static Object call(String path,String method,JSONObject body)throws Exception {
        Object result=api.invoke(activity,path,method,new JSONObject().put("content-type","application/json"),body==null?new byte[0]:body.toString().getBytes(StandardCharsets.UTF_8),generation.getInt(activity),false);
        int status=(Integer)field(result,"status");check(status>=200&&status<300,path+" returned "+status+": "+new String(bytes(result),StandardCharsets.UTF_8));return result;
    }
    private static void patch(String path,JSONObject body)throws Exception{call(path,"PATCH",body);}
    private static String upload(String country,String caption)throws Exception {
        ByteArrayOutputStream data=new ByteArrayOutputStream();
        data.write(("--standalone-test\r\nContent-Disposition: form-data; name=\"countryId\"\r\n\r\n"+country+"\r\n--standalone-test\r\nContent-Disposition: form-data; name=\"caption\"\r\n\r\n"+caption+"\r\n--standalone-test\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"memory.png\"\r\nContent-Type: image/png\r\n\r\n").getBytes(StandardCharsets.UTF_8));data.write(IMAGE);data.write("\r\n--standalone-test--\r\n".getBytes(StandardCharsets.UTF_8));
        Object result=api.invoke(activity,"/api/photos","POST",new JSONObject().put("content-type","multipart/form-data; boundary=standalone-test"),data.toByteArray(),generation.getInt(activity),false);
        check((Integer)field(result,"status")==201,"Local photo upload succeeds");return json(result).getString("id");
    }
    private static JSONObject json(Object result)throws Exception{return new JSONObject(new String(bytes(result),StandardCharsets.UTF_8));}
    private static Object field(Object object,String name)throws Exception{Field field=object.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(object);}
    private static byte[] bytes(Object result)throws Exception{return(byte[])field(result,"bytes");}
    private static JSONObject find(JSONArray items,String key,String value)throws Exception{for(int i=0;i<items.length();i++){JSONObject item=items.getJSONObject(i);if(value.equals(item.optString(key)))return item;}throw new AssertionError("Missing "+key+" "+value);}
    private static void waitSync()throws Exception{for(int i=0;i<120;i++){JSONObject status=json(call("/api/local-status","GET",null));if(status.optBoolean("connected")&&status.getInt("pending")==0){Thread.sleep(200);return;}Thread.sleep(250);}throw new AssertionError("Sync did not finish: "+json(call("/api/local-status","GET",null)));}
    private static String decode(String encoded)throws Exception{byte[] bytes=Base64.decode(encoded,Base64.DEFAULT);Bitmap image=BitmapFactory.decodeByteArray(bytes,0,bytes.length);int[] pixels=new int[image.getWidth()*image.getHeight()];image.getPixels(pixels,0,image.getWidth(),0,0,image.getWidth(),image.getHeight());String link=new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(image.getWidth(),image.getHeight(),pixels)))).getText();image.recycle();return link;}
    private static JSONObject remote(String origin,String cookie,String path,String method,JSONObject body)throws Exception{HttpURLConnection connection=(HttpURLConnection)new URL(origin+path).openConnection();try{connection.setConnectTimeout(5000);connection.setReadTimeout(5000);connection.setRequestMethod(method);connection.setRequestProperty("Origin",origin);connection.setRequestProperty("Cookie",cookie);if(body!=null){connection.setRequestProperty("Content-Type","application/json");connection.setDoOutput(true);try(java.io.OutputStream out=connection.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}check(connection.getResponseCode()==200,"PC test request "+path);try(InputStream input=connection.getInputStream()){return new JSONObject(new String(input.readAllBytes(),StandardCharsets.UTF_8));}}finally{connection.disconnect();}}
    private static String js(String script)throws Exception{CountDownLatch done=new CountDownLatch(1);AtomicReference<String> answer=new AtomicReference<>();test.runOnMainSync(()->{try{Field web=MainActivity.class.getDeclaredField("web");web.setAccessible(true);((WebView)web.get(activity)).evaluateJavascript(script,result->{answer.set(result);done.countDown();});}catch(Exception error){answer.set("ERROR "+error);done.countDown();}});check(done.await(15,TimeUnit.SECONDS),"JavaScript completed: "+script);return answer.get();}
    private static void waitUi(String expression,String label)throws Exception{for(int i=0;i<120;i++){if("true".equals(js("Boolean("+expression+")")))return;Thread.sleep(250);}throw new AssertionError(label+": "+js("document.body.innerText"));}
    private static void check(boolean condition,String label){if(!condition)throw new AssertionError(label);}
}
