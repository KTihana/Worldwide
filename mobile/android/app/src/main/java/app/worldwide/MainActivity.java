package app.worldwide;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.journeyapps.barcodescanner.ScanOptions;
import com.journeyapps.barcodescanner.ScanIntentResult;
import com.google.zxing.client.android.Intents;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** A bundled offline app. Only its local origin can access the private native bridge. */
public class MainActivity extends Activity {
    private static final String APP_ORIGIN="https://app.worldwide.local";
    private WebView web;
    private SharedPreferences prefs;
    private File album;
    private final ExecutorService executor=Executors.newFixedThreadPool(4);
    private volatile int generation=0;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingSave;
    private String pendingSaveId;
    private String pendingScanId;
    private volatile String pendingPairLink="";
    private AndroidUpdater updater;
    private final java.util.concurrent.atomic.AtomicBoolean updateBusy=new java.util.concurrent.atomic.AtomicBoolean();

    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        prefs=getSharedPreferences("worldwide",MODE_PRIVATE);
        updater=new AndroidUpdater(this,(percent,status)->runOnUiThread(()->{if(web!=null)try{JSONObject detail=new JSONObject().put("progress",percent).put("status",status);web.evaluateJavascript("window.dispatchEvent(new CustomEvent('worldwide-update-progress',{detail:"+detail+"}))",null);}catch(Exception ignored){}}));
        album=new File(getFilesDir(),"album");album.mkdirs();
        receivePairLink(getIntent());
        web=new WebView(this);web.setBackgroundColor(Color.rgb(237,242,239));
        setContentView(web);
        web.setOnApplyWindowInsetsListener((view,insets)->{
            if(android.os.Build.VERSION.SDK_INT>=30){android.graphics.Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());view.setPadding(safe.left,safe.top,safe.right,safe.bottom);}
            else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.addJavascriptInterface(new Bridge(),"WorldwideNative");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){String path=request.getUrl().getPath();if(request.isForMainFrame()&&"https://github.com/KTihana/Worldwide/releases/latest/download/Worldwide-Android.apk".equals(request.getUrl().toString())){try{startActivity(new Intent(Intent.ACTION_VIEW,request.getUrl()));}catch(Exception ignored){}return true;}return !trusted(request.getUrl())||request.isForMainFrame()&&!("/".equals(path)||"/index.html".equals(path));}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                if(!trusted(request.getUrl()))return resource(403,"text/plain","External navigation is disabled".getBytes(StandardCharsets.UTF_8),false);
                String path=request.getUrl().getPath();
                try{
                    if(path.startsWith("/api/")){
                        if(!request.getMethod().equals("GET"))return resource(405,"text/plain",new byte[0],false);
                        Result response=api(path,"GET",new JSONObject(),new byte[0],generation,true);
                        return resource(response.status,response.mime,response.bytes,response.offline);
                    }
                    if(path.equals("/"))path="/index.html";
                    if(path.contains("..")||path.contains("\\"))throw new IOException("Invalid asset");
                    return new WebResourceResponse(mime(path),"UTF-8",200,"OK",headers("Content-Security-Policy","default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'"),getAssets().open("www"+path));
                }catch(Exception error){return resource(404,"text/plain",new byte[0],false);}
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams parameters){
                if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=callback;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("image/*");intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);
                try{startActivityForResult(intent,10);}catch(Exception error){fileCallback.onReceiveValue(null);fileCallback=null;}return true;
            }
        });
        web.loadUrl(APP_ORIGIN+"/");
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);receivePairLink(intent);if(web!=null)web.evaluateJavascript("window.dispatchEvent(new Event('worldwide-pair-link'))",null);}
    private void receivePairLink(Intent intent){if(intent!=null&&Intent.ACTION_VIEW.equals(intent.getAction())&&intent.getData()!=null){String value=intent.getData().toString();if(value.length()<=4096&&"worldwide".equals(intent.getData().getScheme())&&"pair".equals(intent.getData().getHost()))pendingPairLink=value;}}
    private boolean trusted(Uri uri){return "https".equals(uri.getScheme())&&"app.worldwide.local".equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443);}
    private static String mime(String path){
        if(path.endsWith(".html"))return "text/html";if(path.endsWith(".js"))return "text/javascript";if(path.endsWith(".css"))return "text/css";
        if(path.endsWith(".json")||path.endsWith(".webmanifest"))return "application/json";if(path.endsWith(".svg"))return "image/svg+xml";if(path.endsWith(".png"))return "image/png";if(path.endsWith(".jpg"))return "image/jpeg";if(path.endsWith(".webp"))return "image/webp";return "application/octet-stream";
    }
    private WebResourceResponse resource(int status,String mime,byte[] bytes,boolean offline){return new WebResourceResponse(mime,"UTF-8",status,status<400?"OK":"Unavailable",headers("Cache-Control","no-store","X-Elsewhere-Offline",offline?"1":"0"),new ByteArrayInputStream(bytes));}
    private static String normalize(String address) throws Exception{
        URI uri=new URI(address.trim());String scheme=uri.getScheme(),host=uri.getHost();
        if(host==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null||!(uri.getPath()==null||uri.getPath().isEmpty()||uri.getPath().equals("/")))throw new IOException("Use only the computer address, such as http://192.168.1.20:3000");
        if(!"https".equals(scheme)&&!("http".equals(scheme)&&privateHost(host)))throw new IOException("Use your computer’s local Wi-Fi address, or a configured HTTPS address.");
        if(uri.getPort()==0||uri.getPort()>65535)throw new IOException("The address has an invalid port.");
        return scheme+"://"+host+(uri.getPort()>0?":"+uri.getPort():"");
    }
    private static boolean privateHost(String host){
        if(host.equals("localhost"))return true;
        String[] parts=host.split("\\.");if(parts.length!=4)return false;
        try{int[] p=new int[4];for(int i=0;i<4;i++){if(!parts[i].matches("[0-9]{1,3}"))return false;p[i]=Integer.parseInt(parts[i]);if(p[i]>255)return false;}
            return p[0]==10||p[0]==127||p[0]==192&&p[1]==168||p[0]==172&&p[1]>=16&&p[1]<=31||p[0]==169&&p[1]==254;
        }catch(Exception error){return false;}
    }
    private static class Result { final int status;final String mime;final byte[] bytes;final boolean offline;final String cookie;Result(int status,String mime,byte[] bytes,boolean offline){this(status,mime,bytes,offline,null);}Result(int status,String mime,byte[] bytes,boolean offline,String cookie){this.status=status;this.mime=mime;this.bytes=bytes;this.offline=offline;this.cookie=cookie;} }
    private static Map<String,String> headers(String... values){Map<String,String> result=new HashMap<>();for(int i=0;i<values.length;i+=2)result.put(values[i],values[i+1]);return result;}
    private Result network(String origin,String path,String method,JSONObject headers,byte[] body,String cookie,int expected) throws Exception{
        if(!path.matches("/api/[a-zA-Z0-9_/-]+")||path.contains(".."))throw new IOException("Invalid API path.");
        HttpURLConnection connection=(HttpURLConnection)new URL(origin+path).openConnection();
        try{
            connection.setConnectTimeout(2500);connection.setReadTimeout(path.equals("/api/auth/session")?2800:15000);connection.setInstanceFollowRedirects(false);connection.setRequestMethod(method);
            connection.setRequestProperty("Origin",origin);connection.setRequestProperty("Accept","application/json");if(!cookie.isEmpty())connection.setRequestProperty("Cookie",cookie);
            if(headers.has("content-type"))connection.setRequestProperty("Content-Type",headers.getString("content-type"));
            if(!method.equals("GET")&&!method.equals("HEAD")){connection.setDoOutput(true);connection.setFixedLengthStreamingMode(body.length);try(OutputStream stream=connection.getOutputStream()){stream.write(body);}}
            int status=connection.getResponseCode();String content=connection.getContentType();if(content==null)content="application/octet-stream";
            InputStream stream=status>=400?connection.getErrorStream():connection.getInputStream();byte[] bytes=stream==null?new byte[0]:readLimited(stream,40*1024*1024);
            if(status>=300&&status<400)throw new IOException("The computer address redirected. Use its direct local address.");
            String sessionCookie=null;
            for(Map.Entry<String,List<String>> entry:connection.getHeaderFields().entrySet())if("set-cookie".equalsIgnoreCase(entry.getKey()))for(String value:entry.getValue()){
                String session=value.split(";",2)[0];if(session.matches("(?:elsewhere|worldwide)_session=[a-f0-9]{64}"))sessionCookie=session;
                else if(session.equals("elsewhere_session=")||session.equals("worldwide_session="))sessionCookie="";
            }
            // Network responses never mutate credentials: callers commit them only after validation.
            return new Result(status,content.split(";")[0],bytes,false,sessionCookie);
        }finally{connection.disconnect();}
    }
    private static byte[] readLimited(InputStream source,int limit) throws IOException{try(InputStream stream=source;ByteArrayOutputStream bytes=new ByteArrayOutputStream()){byte[] buffer=new byte[32768];int n;while((n=stream.read(buffer))!=-1){if(bytes.size()+n>limit)throw new IOException("This file is too large.");bytes.write(buffer,0,n);}return bytes.toByteArray();}}
    private synchronized void clearAlbum(){generation++;prefs.edit().remove("cookie").remove("account").remove("offline-state").apply();File[] files=album.listFiles();if(files!=null)for(File file:files)file.delete();MapWidgetProvider.clear(this);}
    private static class Pairing { final String origin,token;Pairing(String origin,String token){this.origin=origin;this.token=token;} }
    private static Pairing parsePairing(String value)throws Exception{
        if(value==null||value.length()>4096)throw new IOException("Scan the QR code shown in Worldwide on your computer.");
        Uri uri=Uri.parse(value);
        if(!"worldwide".equals(uri.getScheme())||!"pair".equals(uri.getAuthority())||uri.getFragment()!=null||!(uri.getPath()==null||uri.getPath().isEmpty())||!uri.getQueryParameterNames().equals(new HashSet<>(Arrays.asList("server","token")))||uri.getQueryParameters("server").size()!=1||uri.getQueryParameters("token").size()!=1)throw new IOException("This is not a Worldwide pairing QR code.");
        String server=uri.getQueryParameter("server"),token=uri.getQueryParameter("token");
        if(server==null||token==null||!token.matches("[a-f0-9]{64}"))throw new IOException("This pairing QR code is incomplete. Open a new code on your computer.");
        return new Pairing(normalize(server),token);
    }
    private JSONObject pair(String value,int expected)throws Exception{
        Pairing pairing=parsePairing(value);
        Result response;
        try{response=network(pairing.origin,"/api/auth/pair-complete","POST",new JSONObject().put("content-type","application/json"),new JSONObject().put("token",pairing.token).toString().getBytes(StandardCharsets.UTF_8),"",-1);}
        catch(IOException error){throw new IOException("Couldn’t reach your computer. Keep Worldwide open there and use the same Wi-Fi.");}
        JSONObject result;
        try{result=new JSONObject(new String(response.bytes,StandardCharsets.UTF_8));}catch(Exception error){throw new IOException("This computer did not return a Worldwide pairing response.");}
        if(response.status!=200)throw new IOException(result.optString("error","That code expired. Open a new QR code on your computer."));
        JSONObject account=result.optJSONObject("account");String email=account==null?"":account.optString("email");
        if(email.isEmpty()||email.length()>254||response.cookie==null||response.cookie.isEmpty())throw new IOException("Pairing was incomplete. Open a new QR code and try again.");
        synchronized(this){
            if(expected!=generation)throw new IOException("Your connection changed while pairing. Please scan again.");
            // The previous server, session and photo cache survive every failed pairing attempt.
            clearAlbum();
            prefs.edit().putString("server",pairing.origin).putString("cookie",response.cookie).putString("account",new JSONObject().put("account",account).put("needsSetup",false).put("canSetup",false).toString()).commit();
        }
        return new JSONObject().put("value",true);
    }
    private String photoKey(String path) throws Exception{byte[] digest=MessageDigest.getInstance("SHA-256").digest(path.getBytes(StandardCharsets.UTF_8));StringBuilder key=new StringBuilder();for(byte value:digest)key.append(String.format(Locale.ROOT,"%02x",value));return key.toString();}
    private synchronized Result cached(String path) throws Exception{
        File file=new File(album,path.equals("/api/atlas")?"atlas.json":photoKey(path)+".photo");if(!file.isFile())return null;
        File mimeFile=path.equals("/api/atlas")?null:new File(album,photoKey(path)+".mime");if(mimeFile!=null&&!mimeFile.isFile())return null;
        String type=path.equals("/api/atlas")?"application/json":new String(Files.readAllBytes(mimeFile.toPath()),StandardCharsets.UTF_8);if(!path.equals("/api/atlas")&&!type.startsWith("image/"))return null;
        return new Result(200,type,Files.readAllBytes(file.toPath()),true);
    }
    private synchronized void saveCache(String path,Result response,int expected) throws Exception{
        if(expected!=generation||response.status!=200||prefs.getString("cookie","").isEmpty())return;
        String key=path.equals("/api/atlas")?"atlas.json":photoKey(path)+".photo";
        File temporary=File.createTempFile("download-",".tmp",album);Files.write(temporary.toPath(),response.bytes);Files.move(temporary.toPath(),new File(album,key).toPath(),StandardCopyOption.REPLACE_EXISTING);
        if(!path.equals("/api/atlas"))Files.write(new File(album,photoKey(path)+".mime").toPath(),response.mime.getBytes(StandardCharsets.UTF_8));
    }
    private Result api(String path,String method,JSONObject headers,byte[] body,int expected,boolean image) throws Exception{
        String origin=prefs.getString("server",""),cookie=prefs.getString("cookie","");if(origin.isEmpty())throw new IOException("Connect to your computer first.");
        boolean photo=method.equals("GET")&&path.matches("/api/photos/[a-zA-Z0-9_-]+");
        if(photo){Result saved=cached(path);if(saved!=null)return saved;}
        try{
            Result response=network(origin,path,method,headers,body,cookie,expected);
            synchronized(this){
                if(expected!=generation||!origin.equals(prefs.getString("server","")))throw new IOException("The connection changed. Please try again.");
                if(path.equals("/api/auth/logout")&&response.status==200){clearAlbum();return response;}
                if(response.cookie!=null)prefs.edit().putString("cookie",response.cookie).apply();
            }
            if(method.equals("GET")&&(path.equals("/api/atlas")||photo)&&response.status==200)saveCache(path,response,expected);
            return response;
        }catch(IOException error){
            if(expected==generation&&method.equals("GET")&&path.equals("/api/atlas")){Result saved=cached(path);if(saved!=null)return saved;}
            throw new IOException("Couldn’t reach your computer. Keep Worldwide open there and connect to the same Wi-Fi.",error);
        }
    }
    private void reply(String id,JSONObject result){runOnUiThread(()->{if(web!=null)web.evaluateJavascript("window.worldwideNativeReply?.("+JSONObject.quote(id)+","+result+")",null);});}
    private void fail(String id,Exception error){try{reply(id,new JSONObject().put("error",error.getMessage()==null?"Please try again.":error.getMessage()));}catch(Exception ignored){}}
    private void progress(int saved,int total){runOnUiThread(()->{if(web!=null)web.evaluateJavascript("window.worldwideNativeProgress?.("+saved+","+total+")",null);});}
    private static String scanContents(int result,Intent intent)throws IOException{
        if(intent!=null&&intent.getBooleanExtra(Intents.Scan.MISSING_CAMERA_PERMISSION,false))throw new IOException("Allow camera access to scan, or enter your computer address instead.");
        ScanIntentResult scan=ScanIntentResult.parseActivityResult(result,intent);return scan.getContents()==null?"":scan.getContents();
    }
    private class Bridge {
        @JavascriptInterface public void setOrientation(String mode){
            final int requested;
            if("portrait".equals(mode))requested=ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
            else if("landscape".equals(mode))requested=ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
            else return;
            // Bridge calls arrive off the UI thread; ignore stale activity/page requests.
            runOnUiThread(()->{
                if(isFinishing()||isDestroyed()||web==null)return;
                String url=web.getUrl();
                if(url==null||!trusted(Uri.parse(url))||getRequestedOrientation()==requested)return;
                setRequestedOrientation(requested);
            });
        }
        @JavascriptInterface public void checkUpdate(String id){executor.execute(()->{try{reply(id,new JSONObject().put("value",updater.check()));}catch(Exception error){fail(id,error);}});}
        @JavascriptInterface public void installUpdate(String id){
            if(!updateBusy.compareAndSet(false,true)){fail(id,new IOException("An update is already being prepared."));return;}
            executor.execute(()->{try{File file=updater.prepare();runOnUiThread(()->{try{if(isFinishing()||isDestroyed())throw new IOException("Open Worldwide again to install the update.");reply(id,new JSONObject().put("value",new JSONObject().put("status",AndroidUpdater.install(MainActivity.this,file))));}catch(Exception error){fail(id,error);}finally{updateBusy.set(false);}});}catch(Exception error){updateBusy.set(false);fail(id,error);}});
        }
        @JavascriptInterface public String connection(){return prefs.getString("server","");}
        @JavascriptInterface public String takePairLink(){String value=pendingPairLink;pendingPairLink="";return value;}
        @JavascriptInterface public void scanQr(String id){runOnUiThread(()->{if(pendingScanId!=null){fail(id,new IOException("The camera is already open."));return;}pendingScanId=id;
            ScanOptions options=new ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt("Scan the QR code in Worldwide on your computer").setBeepEnabled(false).setBarcodeImageEnabled(false).setOrientationLocked(false);
            try{startActivityForResult(options.createScanIntent(MainActivity.this),12);}catch(Exception error){pendingScanId=null;fail(id,new IOException("Couldn’t open the camera. You can enter your computer address instead."));}
        });}
        @JavascriptInterface public void pairQr(String id,String value){int expected=generation;executor.execute(()->{try{reply(id,pair(value,expected));}catch(Exception error){fail(id,error);}});}
        @JavascriptInterface public void configure(String id,String address){executor.execute(()->{try{
            String origin=normalize(address);Result health=network(origin,"/api/health","GET",new JSONObject(),new byte[0],"",-1);
            JSONObject data=new JSONObject(new String(health.bytes,StandardCharsets.UTF_8));String app=data.optString("app");
            if(health.status!=200||!(app.equals("worldwide-local")||app.equals("elsewhere-local")))throw new IOException("This address is not a Worldwide computer.");
            if(!origin.equals(connection())){MainActivity.this.clearAlbum();prefs.edit().putString("server",origin).commit();}
            reply(id,new JSONObject().put("value",true));
        }catch(Exception error){fail(id,error);}});}
        @JavascriptInterface public void request(String id,String value){int expected=generation;executor.execute(()->{try{
            JSONObject request=new JSONObject(value);byte[] body=Base64.decode(request.optString("body"),Base64.DEFAULT);if(body.length>11*1024*1024)throw new IOException("This upload is too large.");
            Result result=api(request.getString("path"),request.getString("method"),request.optJSONObject("headers"),body,expected,false);
            reply(id,new JSONObject().put("status",result.status).put("headers",new JSONObject().put("Content-Type",result.mime).put("X-Elsewhere-Offline",result.offline?"1":"0")).put("body",Base64.encodeToString(result.bytes,Base64.NO_WRAP)));
        }catch(Exception error){fail(id,error);}});}
        @JavascriptInterface public String read(String key){return Arrays.asList("account","offline-state").contains(key)?prefs.getString(key,""):"";}
        @JavascriptInterface public void store(String key,String value){synchronized(MainActivity.this){
            if(!Arrays.asList("account","offline-state").contains(key)||value.length()>=10000||prefs.getString("cookie","").isEmpty())return;
            try{
                JSONObject data=new JSONObject(value);
                if(key.equals("account")){
                    String email=data.getJSONObject("account").getString("email"),existing=prefs.getString("account","");
                    if(email.isEmpty()||email.length()>254)return;
                    if(!existing.isEmpty()&&!new JSONObject(existing).getJSONObject("account").getString("email").equals(email))return;
                }else if(data.optBoolean("ready")){
                    Result snapshot=cached("/api/atlas");if(snapshot==null)return;
                    JSONArray photos=new JSONObject(new String(snapshot.bytes,StandardCharsets.UTF_8)).getJSONArray("photos");
                    if(photos.length()!=data.optInt("total",-1)||photos.length()!=data.optInt("saved",-1))return;
                    for(int i=0;i<photos.length();i++){String photo=photoKey("/api/photos/"+photos.getJSONObject(i).getString("id"));if(!new File(album,photo+".photo").isFile()||!new File(album,photo+".mime").isFile())return;}
                }
                prefs.edit().putString(key,value).apply();
            }catch(Exception ignored){}
        }}
        @JavascriptInterface public void clearAlbum(){MainActivity.this.clearAlbum();}
        @JavascriptInterface public void syncAlbum(String id,String value){int expected=generation;executor.execute(()->{try{
            JSONObject data=new JSONObject(value);JSONArray photos=data.getJSONArray("photos");Set<String> keep=new HashSet<>(Arrays.asList("atlas.json"));
            saveCache("/api/atlas",new Result(200,"application/json",value.getBytes(StandardCharsets.UTF_8),false),expected);
            int saved=0;progress(saved,photos.length());
            for(int i=0;i<photos.length();i++){
                if(expected!=generation)throw new IOException("The album changed.");String photo=photos.getJSONObject(i).getString("id");if(!photo.matches("[a-zA-Z0-9_-]+"))throw new IOException("Invalid photo.");
                String path="/api/photos/"+photo;Result result=api(path,"GET",new JSONObject(),new byte[0],expected,true);if(result.status!=200)throw new IOException("Couldn’t save every photo. Reconnect and try again.");
                keep.add(photoKey(path)+".photo");keep.add(photoKey(path)+".mime");progress(++saved,photos.length());
            }
            synchronized(MainActivity.this){if(expected!=generation)throw new IOException("The album changed.");File[] files=album.listFiles();if(files!=null)for(File file:files)if(!keep.contains(file.getName()))file.delete();}
            synchronized(MainActivity.this){if(expected==generation)MapWidgetProvider.refresh(MainActivity.this);}
            reply(id,new JSONObject().put("value",true));
        }catch(Exception error){fail(id,error);}});}
        @JavascriptInterface public void saveFile(String id,String name,String mime,String encoded){executor.execute(()->{try{
            byte[] data=Base64.decode(encoded,Base64.DEFAULT);if(data.length>40*1024*1024)throw new IOException("This image is too large to save.");
            runOnUiThread(()->{if(pendingSave!=null){fail(id,new IOException("Finish saving the current image first."));return;}pendingSave=data;pendingSaveId=id;
                Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(mime.startsWith("image/")?mime:"image/png");intent.putExtra(Intent.EXTRA_TITLE,name.replaceAll("[/\\\\]","_"));
                try{startActivityForResult(intent,11);}catch(Exception error){pendingSave=null;pendingSaveId=null;fail(id,error);}});
        }catch(Exception error){fail(id,error);}});}
    }
    @Override protected void onActivityResult(int request,int result,Intent intent){
        super.onActivityResult(request,result,intent);
        if(request==12&&pendingScanId!=null){String id=pendingScanId;pendingScanId=null;try{
            reply(id,new JSONObject().put("value",scanContents(result,intent)));
        }catch(Exception error){fail(id,error);}return;}
        if(request==10&&fileCallback!=null){List<Uri> files=new ArrayList<>();if(result==RESULT_OK&&intent!=null){if(intent.getClipData()!=null){for(int i=0;i<intent.getClipData().getItemCount();i++)files.add(intent.getClipData().getItemAt(i).getUri());}else if(intent.getData()!=null)files.add(intent.getData());}fileCallback.onReceiveValue(files.isEmpty()?null:files.toArray(new Uri[0]));fileCallback=null;}
        if(request==11&&pendingSave!=null){byte[] data=pendingSave;String id=pendingSaveId;pendingSave=null;pendingSaveId=null;
            if(result!=RESULT_OK||intent==null||intent.getData()==null){fail(id,new IOException("Save cancelled."));return;}Uri uri=intent.getData();executor.execute(()->{try(OutputStream stream=getContentResolver().openOutputStream(uri)){if(stream==null)throw new IOException("Couldn’t open that location.");stream.write(data);reply(id,new JSONObject().put("value",true));}catch(Exception error){fail(id,error);}});
        }
    }
    @Override public void onBackPressed(){web.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",null);}
    @Override protected void onDestroy(){if(fileCallback!=null)fileCallback.onReceiveValue(null);executor.shutdownNow();web.removeJavascriptInterface("WorldwideNative");web.destroy();web=null;super.onDestroy();}
}
