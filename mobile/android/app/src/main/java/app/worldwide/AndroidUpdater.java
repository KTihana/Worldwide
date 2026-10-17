package app.worldwide;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
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

/** Downloads code only. Never reads, sends, moves or removes the private album. */
final class AndroidUpdater {
    private static final String LATEST="https://api.github.com/repos/KTihana/Worldwide/releases/latest";
    private static final long MAX_APK=200L*1024*1024;
    interface Progress { void update(int percent,String status); }
    private final Context context;
    private final Progress progress;
    private Release checked;
    AndroidUpdater(Context context,Progress progress){this.context=context.getApplicationContext();this.progress=progress;}

    static final class Release {
        final String version,url,digest;final long size;
        Release(String version,String url,String digest,long size){this.version=version;this.url=url;this.digest=digest;this.size=size;}
    }
    static Release parseRelease(JSONObject json)throws Exception{
        if(json.optBoolean("draft")||json.optBoolean("prerelease"))throw new IOException("No stable update is available yet.");
        String tag=json.getString("tag_name"),version=tag.replaceFirst("^v","");
        if(!version.matches("[0-9]+\\.[0-9]+\\.[0-9]+"))throw new IOException("The update version could not be verified.");
        JSONArray assets=json.getJSONArray("assets");Release result=null;
        for(int i=0;i<assets.length();i++){
            JSONObject asset=assets.getJSONObject(i);if(!"Worldwide-Android.apk".equals(asset.optString("name")))continue;
            if(result!=null)throw new IOException("The release has ambiguous Android downloads.");
            String url=asset.getString("browser_download_url");URI uri=new URI(url);
            if(!trustedDownload(url)||!"github.com".equals(uri.getHost())||!uri.getRawPath().equals("/KTihana/Worldwide/releases/download/"+tag+"/Worldwide-Android.apk")||uri.getQuery()!=null)throw new IOException("The Android update is not from Worldwide’s release page.");
            long size=asset.getLong("size");if(size<=0||size>MAX_APK)throw new IOException("The update size is invalid.");
            String digest=asset.isNull("digest")?"":asset.optString("digest","");
            if(!digest.isEmpty()&&!digest.matches("sha256:[a-fA-F0-9]{64}"))throw new IOException("The update checksum is invalid.");
            result=new Release(version,url,digest.toLowerCase(Locale.ROOT),size);
        }
        if(result==null)throw new IOException("This release has no Android update yet. Please try again later.");
        return result;
    }
    static boolean newer(String candidate,String installed){
        try{String[] a=candidate.replaceFirst("^v","").split("\\."),b=installed.replaceFirst("^v","").split("\\.");if(a.length!=3||b.length!=3)return false;for(int i=0;i<3;i++){long x=Long.parseLong(a[i]),y=Long.parseLong(b[i]);if(x!=y)return x>y;}return false;}catch(Exception ignored){return false;}
    }
    static boolean trustedDownload(String value){
        try{URI uri=new URI(value);if(!"https".equals(uri.getScheme())||uri.getUserInfo()!=null||uri.getFragment()!=null||(uri.getPort()!=-1&&uri.getPort()!=443))return false;
            String host=uri.getHost();return "github.com".equals(host)&&uri.getPath().startsWith("/KTihana/Worldwide/releases/download/")||"release-assets.githubusercontent.com".equals(host)||"objects.githubusercontent.com".equals(host)||"github-releases.githubusercontent.com".equals(host);
        }catch(Exception ignored){return false;}
    }
    private static HttpURLConnection open(String address,boolean download)throws Exception{
        String next=address;
        for(int redirects=0;redirects<=5;redirects++){
            if(download?!trustedDownload(next):!LATEST.equals(next))throw new IOException("The update redirected outside the trusted release service.");
            HttpURLConnection connection=(HttpURLConnection)new URL(next).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(30000);connection.setRequestProperty("User-Agent","Worldwide-Android-Updater");connection.setRequestProperty("Accept",download?"application/octet-stream":"application/vnd.github+json");
            int code=connection.getResponseCode();if(code==200)return connection;
            if(download&&(code==301||code==302||code==303||code==307||code==308)){String location=connection.getHeaderField("Location");connection.disconnect();if(location==null)break;next=new URL(new URL(next),location).toString();continue;}
            connection.disconnect();throw new IOException(code==403||code==429?"Update checks are temporarily limited. Try again later.":"Couldn’t get the update. Check your internet connection and try again.");
        }
        throw new IOException("The update download redirected too many times.");
    }
    synchronized JSONObject check()throws Exception{
        checked=null;HttpURLConnection connection=open(LATEST,false);byte[] bytes;
        try(InputStream in=connection.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buffer=new byte[16384];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>2*1024*1024)throw new IOException("The release response is too large.");out.write(buffer,0,n);}bytes=out.toByteArray();
        }finally{connection.disconnect();}
        Release release=parseRelease(new JSONObject(new String(bytes,StandardCharsets.UTF_8)));
        String installed=installed(context).versionName;checked=release;
        return new JSONObject().put("version",release.version).put("installedVersion",installed).put("available",newer(release.version,installed));
    }
    synchronized File prepare()throws Exception{
        if(checked==null)check();Release release=checked;
        if(!newer(release.version,installed(context).versionName))throw new IOException("You already have the latest version.");
        File directory=new File(context.getCacheDir(),"updates");if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("Couldn’t prepare the update. Free some phone storage and try again.");
        File ready=new File(directory,"Worldwide-"+release.version+".apk");
        if(ready.isFile())try{verifyDownload(ready,release);validateApk(context,ready,release.version);return ready;}catch(Exception ignored){ready.delete();}
        File partial=new File(directory,"download.tmp");HttpURLConnection connection=open(release.url,true);
        try{
            long length=connection.getContentLengthLong();if(length>0&&length!=release.size)throw new IOException("The update download size changed. Check for updates again.");
            try(InputStream in=connection.getInputStream();FileOutputStream out=new FileOutputStream(partial)){
                byte[] buffer=new byte[65536];long count=0;int n,last=-1;
                while((n=in.read(buffer))!=-1){if(Thread.currentThread().isInterrupted())throw new IOException("Update download interrupted. Please try again.");count+=n;if(count>release.size||count>MAX_APK)throw new IOException("The update download was larger than expected.");out.write(buffer,0,n);int percent=(int)(count*100/release.size);if(percent!=last){last=percent;progress.update(percent,"Downloading update…");}}
                out.getFD().sync();
            }
            progress.update(100,"Checking update…");verifyDownload(partial,release);validateApk(context,partial,release.version);
            Files.move(partial.toPath(),ready.toPath(),StandardCopyOption.REPLACE_EXISTING);
            // Only this updater's cached installers are eligible for cleanup.
            File[] old=directory.listFiles();if(old!=null)for(File file:old)if(!file.equals(ready)&&file.getName().matches("Worldwide-[0-9]+\\.[0-9]+\\.[0-9]+\\.apk"))file.delete();
            return ready;
        }finally{connection.disconnect();partial.delete();}
    }
    static void verifyDownload(File file,Release release)throws Exception{
        if(file.length()!=release.size)throw new IOException("The update download is incomplete. Please try again.");
        if(!release.digest.isEmpty()){
            MessageDigest hash=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1)hash.update(buffer,0,n);}
            StringBuilder hex=new StringBuilder("sha256:");for(byte value:hash.digest())hex.append(String.format(Locale.ROOT,"%02x",value));
            if(!MessageDigest.isEqual(hex.toString().getBytes(StandardCharsets.UTF_8),release.digest.getBytes(StandardCharsets.UTF_8)))throw new IOException("The update checksum did not match. Please try again.");
        }
    }
    private static int signatureFlags(){return Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;}
    private static PackageInfo installed(Context context)throws Exception{return context.getPackageManager().getPackageInfo(context.getPackageName(),signatureFlags());}
    private static Set<String> signers(PackageInfo info){Signature[] signatures=Build.VERSION.SDK_INT>=28&&info.signingInfo!=null?info.signingInfo.getApkContentsSigners():info.signatures;Set<String> result=new HashSet<>();if(signatures!=null)for(Signature signature:signatures)result.add(signature.toCharsString());return result;}
    static PackageInfo validateApk(Context context,File file,String expectedVersion)throws Exception{
        PackageInfo current=installed(context),candidate=context.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(),signatureFlags());
        if(candidate==null||!context.getPackageName().equals(candidate.packageName))throw new IOException("This download is not a Worldwide update.");
        long oldCode=Build.VERSION.SDK_INT>=28?current.getLongVersionCode():current.versionCode,newCode=Build.VERSION.SDK_INT>=28?candidate.getLongVersionCode():candidate.versionCode;
        if(newCode<=oldCode||!expectedVersion.equals(candidate.versionName)||!newer(candidate.versionName,current.versionName))throw new IOException("This update is not newer than your installed app.");
        Set<String> approved=signers(current);if(approved.isEmpty()||!approved.equals(signers(candidate)))throw new IOException("This update was signed with a different key. Your current app and photos are unchanged.");
        return candidate;
    }
    static String install(Activity activity,File file)throws Exception{
        if(!activity.getPackageManager().canRequestPackageInstalls()){
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+activity.getPackageName())));return "permission-required";
        }
        Uri uri=FileProvider.getUriForFile(activity,activity.getPackageName()+".updates",file);
        Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        activity.startActivity(intent);return "installer-opened";
    }
}
