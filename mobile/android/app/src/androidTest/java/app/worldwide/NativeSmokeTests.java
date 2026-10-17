package app.worldwide;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Base64;
import org.json.JSONObject;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayOutputStream;

/** Run only against the disposable local test server, through adb reverse. */
public class NativeSmokeTests extends Instrumentation {
    private Bundle args;
    @Override public void onCreate(Bundle value){args=value;start();}
    @Override public void onStart(){Bundle report=new Bundle();MainActivity activity=null;try{
        String origin=args.getString("server","http://127.0.0.1:3302");
        SharedPreferences prefs=getTargetContext().getSharedPreferences("worldwide",0);prefs.edit().clear().putString("server",origin).commit();
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        Thread.sleep(1500);
        Method api=MainActivity.class.getDeclaredMethod("api",String.class,String.class,JSONObject.class,byte[].class,int.class,boolean.class);api.setAccessible(true);
        Field generation=MainActivity.class.getDeclaredField("generation");generation.setAccessible(true);
        JSONObject json=new JSONObject().put("content-type","application/json");
        Object login=api.invoke(activity,"/api/auth/login","POST",json,new JSONObject().put("email","native@example.test").put("password","Worldwide native test 2026").toString().getBytes(StandardCharsets.UTF_8),generation.getInt(activity),false);
        check(status(login)==200,"Native account login");check(!prefs.getString("cookie","").isEmpty(),"Session retained privately");
        Object visit=api.invoke(activity,"/api/countries/HRV","PATCH",json,"{\"visited\":true}".getBytes(StandardCharsets.UTF_8),generation.getInt(activity),false);
        check(status(visit)==200,"PATCH visit succeeds");
        byte[] image=Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9WQAAAAASUVORK5CYII=",Base64.DEFAULT);
        ByteArrayOutputStream multipart=new ByteArrayOutputStream();multipart.write(("--native-test\r\nContent-Disposition: form-data; name=\"countryId\"\r\n\r\nHRV\r\n--native-test\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"test.png\"\r\nContent-Type: image/png\r\n\r\n").getBytes(StandardCharsets.UTF_8));multipart.write(image);multipart.write("\r\n--native-test--\r\n".getBytes(StandardCharsets.UTF_8));
        Object upload=api.invoke(activity,"/api/photos","POST",new JSONObject().put("content-type","multipart/form-data; boundary=native-test"),multipart.toByteArray(),generation.getInt(activity),false);
        check(status(upload)==201,"Native multipart upload succeeds");String photo=new JSONObject(new String(bytes(upload),StandardCharsets.UTF_8)).getString("id");
        Object crop=api.invoke(activity,"/api/photos/"+photo,"PATCH",json,"{\"cropX\":0.4,\"cropY\":-0.2,\"cropZoom\":1.5}".getBytes(StandardCharsets.UTF_8),generation.getInt(activity),false);check(status(crop)==200,"Native crop saves");
        Object downloaded=api.invoke(activity,"/api/photos/"+photo,"GET",json,new byte[0],generation.getInt(activity),true);check(status(downloaded)==200&&bytes(downloaded).length==image.length,"Photo saved on Android");
        Object atlas=api.invoke(activity,"/api/atlas","GET",json,new byte[0],generation.getInt(activity),false);check(status(atlas)==200,"Album saved on Android");
        String atlasText=new String(bytes(atlas),StandardCharsets.UTF_8);check(atlasText.contains("Created on PC before phone sync"),"PC-created edit reaches Android snapshot");
        prefs.edit().putString("server","http://127.0.0.1:1").commit();
        Object offline=api.invoke(activity,"/api/atlas","GET",json,new byte[0],generation.getInt(activity),false);Field offlineFlag=offline.getClass().getDeclaredField("offline");offlineFlag.setAccessible(true);check(offlineFlag.getBoolean(offline),"Disconnected album marks read-only");
        Object saved=api.invoke(activity,"/api/photos/"+photo,"GET",json,new byte[0],generation.getInt(activity),true);check(bytes(saved).length==image.length,"Photo available with server unreachable");
        Method clear=MainActivity.class.getDeclaredMethod("clearAlbum");clear.setAccessible(true);clear.invoke(activity);Method cache=MainActivity.class.getDeclaredMethod("cached",String.class);cache.setAccessible(true);check(cache.invoke(activity,"/api/atlas")==null&&cache.invoke(activity,"/api/photos/"+photo)==null,"Sign out clears private offline files");
        Method normalize=MainActivity.class.getDeclaredMethod("normalize",String.class);normalize.setAccessible(true);
        for(String bad:new String[]{"http://example.com","file:///etc/passwd","http://192.168.1.20:3000/api/atlas","http://user:password@192.168.1.20:3000","javascript:alert(1)"}){try{normalize.invoke(null,bad);throw new AssertionError("Unsafe address accepted: "+bad);}catch(InvocationTargetException expected){}}
        report.putString("stream","Worldwide Android: login, PATCH visits/crops, multipart upload, private photo storage, disconnected access, signout purge, and address restrictions passed.\n");finish(-1,report);
    }catch(Throwable error){report.putString("stream","Native smoke test failed: "+error+" / "+error.getCause()+"\n");finish(1,report);}finally{if(activity!=null){MainActivity value=activity;runOnMainSync(value::finish);}}}
    private static int status(Object value)throws Exception{Field field=value.getClass().getDeclaredField("status");field.setAccessible(true);return field.getInt(value);}
    private static byte[] bytes(Object value)throws Exception{Field field=value.getClass().getDeclaredField("bytes");field.setAccessible(true);return(byte[])field.get(value);}
    private static void check(boolean condition,String label){if(!condition)throw new AssertionError(label);}
}
