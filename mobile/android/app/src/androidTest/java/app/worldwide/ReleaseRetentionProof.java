package app.worldwide;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;
import org.json.JSONObject;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Explicit emulator-only release check, signed with the app's existing key by the test operator. */
final class ReleaseRetentionProof {
    static void run(Instrumentation instrumentation,Bundle args)throws Exception{
        Context context=instrumentation.getTargetContext();
        if(!context.getPackageName().equals("app.worldwide")||!(android.os.Build.HARDWARE.equals("ranchu")||android.os.Build.HARDWARE.equals("goldfish")))throw new AssertionError("Use only the dedicated emulator");
        File photo=new File(context.getFilesDir(),"album/update-retention-proof.photo"),snapshot=new File(context.getCacheDir(),"update-retention-proof.json");
        byte[] fixture="offline-photo-update-proof".getBytes(StandardCharsets.UTF_8);
        if("before".equals(args.getString("phase"))){
            if(photo.exists()||snapshot.exists())throw new AssertionError("An earlier proof exists; inspect it before retrying");
            photo.getParentFile().mkdirs();Files.write(photo.toPath(),fixture);
            JSONObject saved=new JSONObject().put("preferences",new JSONObject(context.getSharedPreferences("worldwide",0).getAll()).toString());
            Files.write(snapshot.toPath(),saved.toString().getBytes(StandardCharsets.UTF_8));return;
        }
        JSONObject saved=new JSONObject(new String(Files.readAllBytes(snapshot.toPath()),StandardCharsets.UTF_8));
        JSONObject before=new JSONObject(saved.getString("preferences")),after=new JSONObject(context.getSharedPreferences("worldwide",0).getAll());
        if(before.length()!=after.length())throw new AssertionError("Account preference count changed");
        for(java.util.Iterator<String> keys=before.keys();keys.hasNext();){String key=keys.next();if(!String.valueOf(before.get(key)).equals(String.valueOf(after.get(key))))throw new AssertionError("A saved account preference changed");}
        if(!Arrays.equals(fixture,Files.readAllBytes(photo.toPath())))throw new AssertionError("Offline photo changed");
        if(!args.getString("version").equals(context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionName))throw new AssertionError("Expected release not installed");
        photo.delete();snapshot.delete();
    }
}
