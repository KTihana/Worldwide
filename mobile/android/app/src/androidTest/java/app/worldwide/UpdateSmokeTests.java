package app.worldwide;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;
import androidx.core.content.FileProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;

/** Runs only in a separate disposable package; never resets a real album. */
final class UpdateSmokeTests {
    private interface Attempt {void run()throws Exception;}
    private static void check(boolean value,String label){if(!value)throw new AssertionError(label);}
    private static void rejects(Attempt action,String label)throws Exception{try{action.run();}catch(Exception expected){return;}throw new AssertionError(label);}
    static void run(Instrumentation test,Bundle args)throws Exception{
        Context context=test.getTargetContext();check(context.getPackageName().equals("app.worldwide.updatetest"),"Updater tests require their disposable package");
        File photo=new File(context.getFilesDir(),"album/update-retention.photo");
        if("after".equals(args.getString("phase"))){
            check("private-test-session".equals(context.getSharedPreferences("worldwide",0).getString("cookie","")),"Update retained account cookie");
            check("offline-photo-fixture".equals(new String(Files.readAllBytes(photo.toPath()),StandardCharsets.UTF_8)),"Update retained offline photo bytes");
            check(context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionName.equals(args.getString("version")),"Updated binary installed");return;
        }
        String version=args.getString("version"),tag="v"+version,url="https://github.com/KTihana/Worldwide/releases/download/"+tag+"/Worldwide-Android.apk";
        JSONObject asset=new JSONObject().put("name","Worldwide-Android.apk").put("browser_download_url",url).put("size",20);
        JSONObject release=new JSONObject().put("tag_name",tag).put("assets",new JSONArray().put(asset));
        check(AndroidUpdater.parseRelease(release).version.equals(version),"Official release accepted");
        check(AndroidUpdater.newer("1.10.0","1.9.0")&&!AndroidUpdater.newer("1.2.0","1.2.0")&&!AndroidUpdater.newer("1.1.9","1.2.0"),"Versions compare numerically");
        for(String bad:new String[]{"http://github.com/KTihana/Worldwide/releases/download/v1/a.apk","https://github.com.evil.test/KTihana/Worldwide/releases/download/v1/a.apk","https://github.com/other/repo/releases/download/v1/a.apk","https://user:pass@release-assets.githubusercontent.com/a","file:///private.apk","https://release-assets.githubusercontent.com:8080/a"})check(!AndroidUpdater.trustedDownload(bad),"Untrusted URL rejected");
        check(AndroidUpdater.trustedDownload("https://release-assets.githubusercontent.com/github-production-release-asset/a?sig=x"),"GitHub signed redirect accepted");
        asset.put("browser_download_url","https://github.com/other/repo/releases/download/"+tag+"/Worldwide-Android.apk");rejects(()->AndroidUpdater.parseRelease(release),"Other repository rejected");asset.put("browser_download_url",url);
        asset.put("digest","sha256:invalid");rejects(()->AndroidUpdater.parseRelease(release),"Malformed digest rejected");asset.remove("digest");
        release.put("prerelease",true);rejects(()->AndroidUpdater.parseRelease(release),"Prereleases rejected");release.remove("prerelease");
        File candidate=new File(context.getCacheDir(),"updates/candidate.apk"),wrongKey=new File(context.getCacheDir(),"updates/wrong-key.apk"),old=new File(context.getCacheDir(),"updates/old.apk");
        check(AndroidUpdater.validateApk(context,candidate,version).versionName.equals(version),"New signed APK accepted");
        rejects(()->AndroidUpdater.validateApk(context,wrongKey,version),"Different signing certificate rejected");
        rejects(()->AndroidUpdater.validateApk(context,old,version),"Old binary rejected");
        rejects(()->AndroidUpdater.validateApk(context,candidate,"0.0.0"),"Release tag/binary mismatch rejected");
        rejects(()->AndroidUpdater.verifyDownload(candidate,new AndroidUpdater.Release(version,url,"",candidate.length()+1)),"Truncated download rejected");
        rejects(()->AndroidUpdater.verifyDownload(candidate,new AndroidUpdater.Release(version,url,"sha256:"+"0".repeat(64),candidate.length())),"Checksum mismatch rejected");
        photo.getParentFile().mkdirs();Files.write(photo.toPath(),"offline-photo-fixture".getBytes(StandardCharsets.UTF_8));
        check("content".equals(FileProvider.getUriForFile(context,context.getPackageName()+".updates",candidate).getScheme()),"Installer receives private content URI");
        rejects(()->FileProvider.getUriForFile(context,context.getPackageName()+".updates",photo),"Update provider cannot expose album photos");
        context.getSharedPreferences("worldwide",0).edit().putString("cookie","private-test-session").commit();
    }
}
