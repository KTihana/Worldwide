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
import android.app.Activity;
import android.net.Uri;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import com.google.zxing.client.android.Intents;

/** Run only against the disposable local test server, through adb reverse. */
public class NativeSmokeTests extends Instrumentation {
    private Bundle args;
    @Override public void onCreate(Bundle value){args=value;start();}
    @Override public void onStart(){Bundle report=new Bundle();MainActivity activity=null;try{
        if("true".equals(args.getString("widgetOnly"))){WidgetSmokeTests.run(this);report.putString("stream","Transparent widget, country selection, offline photos, resize and privacy passed.\n");finish(-1,report);return;}
        if("true".equals(args.getString("releaseRetention"))){ReleaseRetentionProof.run(this,args);report.putString("stream","Signed Worldwide release retained account settings and offline photo.\n");finish(-1,report);return;}
        if("true".equals(args.getString("updateOnly"))){UpdateSmokeTests.run(this,args);report.putString("stream","Android updater validation and data retention passed.\n");finish(-1,report);return;}
        // JourneyApps' published POM omits its AndroidX runtime camera helpers.
        getTargetContext().getClassLoader().loadClass("androidx.core.content.ContextCompat");
        getTargetContext().getClassLoader().loadClass("androidx.core.app.ActivityCompat");
        String origin=args.getString("server","http://127.0.0.1:3302");
        SharedPreferences prefs=getTargetContext().getSharedPreferences("worldwide",0);prefs.edit().clear().putString("server",origin).commit();
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        Field generation=MainActivity.class.getDeclaredField("generation");generation.setAccessible(true);
        // Wait until the UI's initial anonymous session check has cleared the empty
        // offline account. A fixed delay lets that response race our test login.
        for(int attempt=0;attempt<120&&generation.getInt(activity)==0;attempt++)Thread.sleep(250);
        check(generation.getInt(activity)>0,"Initial anonymous account check completed");
        Method api=MainActivity.class.getDeclaredMethod("api",String.class,String.class,JSONObject.class,byte[].class,int.class,boolean.class);api.setAccessible(true);
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
        byte[] qrBytes=Base64.decode(args.getString("qrPng"),Base64.DEFAULT);Bitmap qrBitmap=BitmapFactory.decodeByteArray(qrBytes,0,qrBytes.length);int[] pixels=new int[qrBitmap.getWidth()*qrBitmap.getHeight()];qrBitmap.getPixels(pixels,0,qrBitmap.getWidth(),0,0,qrBitmap.getWidth(),qrBitmap.getHeight());
        String pairingUrl=new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(qrBitmap.getWidth(),qrBitmap.getHeight(),pixels)))).getText();qrBitmap.recycle();
        Method scan=MainActivity.class.getDeclaredMethod("scanContents",int.class,Intent.class);scan.setAccessible(true);
        check("".equals(scan.invoke(null,Activity.RESULT_CANCELED,null)),"Scanner cancellation is silent");
        Intent scanned=new Intent().putExtra(Intents.Scan.RESULT,pairingUrl).putExtra(Intents.Scan.RESULT_FORMAT,"QR_CODE");check(pairingUrl.equals(scan.invoke(null,Activity.RESULT_OK,scanned)),"Bundled scanner result reaches pairing");
        try{scan.invoke(null,Activity.RESULT_CANCELED,new Intent().putExtra(Intents.Scan.MISSING_CAMERA_PERMISSION,true));throw new AssertionError("Camera denial must explain the address fallback");}catch(InvocationTargetException expected){}
        Method parse=MainActivity.class.getDeclaredMethod("parsePairing",String.class);parse.setAccessible(true);
        for(String bad:new String[]{"https://example.com",pairingUrl+"&token="+"0".repeat(64),pairingUrl.replace("worldwide://pair?","worldwide://pair/other?"),"worldwide://pair?server=http%3A%2F%2Fexample.com&token="+"0".repeat(64),pairingUrl+"#fragment"}){try{parse.invoke(null,bad);throw new AssertionError("Invalid QR accepted");}catch(InvocationTargetException expected){}}
        Method receive=MainActivity.class.getDeclaredMethod("receivePairLink",Intent.class);receive.setAccessible(true);receive.invoke(activity,new Intent(Intent.ACTION_VIEW,Uri.parse(pairingUrl)));Field pendingLink=MainActivity.class.getDeclaredField("pendingPairLink");pendingLink.setAccessible(true);check(pairingUrl.equals(pendingLink.get(activity)),"System camera deep link is retained until the app is ready");pendingLink.set(activity,"");
        Method pair=MainActivity.class.getDeclaredMethod("pair",String.class,int.class);pair.setAccessible(true);Method cacheBefore=MainActivity.class.getDeclaredMethod("cached",String.class);cacheBefore.setAccessible(true);
        String oldCookie=prefs.getString("cookie","");String invalid=Uri.parse(pairingUrl).buildUpon().clearQuery().appendQueryParameter("server",Uri.parse(pairingUrl).getQueryParameter("server")).appendQueryParameter("token","0".repeat(64)).build().toString();
        try{pair.invoke(activity,invalid,generation.getInt(activity));throw new AssertionError("Invalid pairing accepted");}catch(InvocationTargetException expected){}
        check(oldCookie.equals(prefs.getString("cookie",""))&&origin.equals(prefs.getString("server",""))&&cacheBefore.invoke(activity,"/api/photos/"+photo)!=null,"Failed pairing preserves the old account and offline photo");
        pair.invoke(activity,pairingUrl,generation.getInt(activity));check(!oldCookie.equals(prefs.getString("cookie","")),"QR grants a fresh private session");check(prefs.getString("account","").contains("native@example.test"),"QR saves account identity for offline launch");
        Class<?> bridgeClass=Class.forName("app.worldwide.MainActivity$Bridge");Constructor<?> bridgeConstructor=bridgeClass.getDeclaredConstructor(MainActivity.class);bridgeConstructor.setAccessible(true);Object bridge=bridgeConstructor.newInstance(activity);Method store=bridgeClass.getDeclaredMethod("store",String.class,String.class);store.setAccessible(true);
        store.invoke(bridge,"account","{\"account\":{\"email\":\"old@example.test\"}}");check(prefs.getString("account","").contains("native@example.test"),"Late old identity cannot overwrite QR account");
        String pairedCookie=prefs.getString("cookie","");try{pair.invoke(activity,pairingUrl,generation.getInt(activity));throw new AssertionError("QR must be single use");}catch(InvocationTargetException expected){}check(pairedCookie.equals(prefs.getString("cookie","")),"Reused QR cannot erase the paired account");
        check(status(api.invoke(activity,"/api/auth/session","GET",json,new byte[0],generation.getInt(activity),false))==200,"QR session authenticates API calls");
        api.invoke(activity,"/api/atlas","GET",json,new byte[0],generation.getInt(activity),false);api.invoke(activity,"/api/photos/"+photo,"GET",json,new byte[0],generation.getInt(activity),true);
        prefs.edit().putString("server","http://127.0.0.1:1").commit();
        Object offline=api.invoke(activity,"/api/atlas","GET",json,new byte[0],generation.getInt(activity),false);Field offlineFlag=offline.getClass().getDeclaredField("offline");offlineFlag.setAccessible(true);check(offlineFlag.getBoolean(offline),"Disconnected album marks read-only");
        Object saved=api.invoke(activity,"/api/photos/"+photo,"GET",json,new byte[0],generation.getInt(activity),true);check(bytes(saved).length==image.length,"Photo available with server unreachable");
        Method clear=MainActivity.class.getDeclaredMethod("clearAlbum");clear.setAccessible(true);clear.invoke(activity);Method cache=MainActivity.class.getDeclaredMethod("cached",String.class);cache.setAccessible(true);check(cache.invoke(activity,"/api/atlas")==null&&cache.invoke(activity,"/api/photos/"+photo)==null,"Sign out clears private offline files");
        store.invoke(bridge,"account","{\"account\":{\"email\":\"native@example.test\"}}");store.invoke(bridge,"offline-state","{\"ready\":true,\"total\":1,\"saved\":1}");check(prefs.getString("account","").isEmpty()&&prefs.getString("offline-state","").isEmpty(),"Late JavaScript writes cannot recreate offline identity after sign out");
        Method normalize=MainActivity.class.getDeclaredMethod("normalize",String.class);normalize.setAccessible(true);
        for(String bad:new String[]{"http://example.com","file:///etc/passwd","http://192.168.1.20:3000/api/atlas","http://user:password@192.168.1.20:3000","javascript:alert(1)"}){try{normalize.invoke(null,bad);throw new AssertionError("Unsafe address accepted: "+bad);}catch(InvocationTargetException expected){}}
        report.putString("stream","Worldwide Android: login, PATCH visits/crops, multipart upload, private photo storage, disconnected access, signout purge, and address restrictions passed.\nQR decoding and atomic pairing passed: actual PC QR, scanner result/cancel/permission denial, system-camera deep link, strict validation, failed pairing preservation, single use, offline identity.\n");finish(-1,report);
    }catch(Throwable error){java.io.StringWriter stack=new java.io.StringWriter();error.printStackTrace(new java.io.PrintWriter(stack));report.putString("stream","Native smoke test failed: "+stack+"\n");finish(1,report);}finally{if(activity!=null){MainActivity value=activity;runOnMainSync(value::finish);}}}
    private static int status(Object value)throws Exception{Field field=value.getClass().getDeclaredField("status");field.setAccessible(true);return field.getInt(value);}
    private static byte[] bytes(Object value)throws Exception{Field field=value.getClass().getDeclaredField("bytes");field.setAccessible(true);return(byte[])field.get(value);}
    private static void check(boolean condition,String label){if(!condition)throw new AssertionError(label);}
}
