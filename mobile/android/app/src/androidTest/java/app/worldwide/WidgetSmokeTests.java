package app.worldwide;
import android.app.Instrumentation;
import android.appwidget.*;
import android.content.*;
import android.graphics.*;
import android.graphics.drawable.BitmapDrawable;
import android.os.Bundle;
import android.view.View;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Locale;

public class WidgetSmokeTests {
    static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
    static View inflate(Instrumentation test,Context c,RemoteViews views){final View[] result={null};test.runOnMainSync(()->result[0]=views.apply(c,new FrameLayout(c)));return result[0];}
    public static void run(Instrumentation test)throws Exception {
        Context c=test.getTargetContext();check(c.getPackageName().equals("app.worldwide.widgettest"),"Only disposable test package allowed");
        File dir=new File(c.getFilesDir(),"album");dir.mkdirs();
        c.getSharedPreferences("worldwide",0).edit().putString("cookie","test-fixture").commit();
        Files.write(new File(dir,"atlas.json").toPath(),"{\"photos\":[{\"id\":\"widget-fixture\",\"countryId\":\"HRV\"},{\"id\":\"missing\",\"countryId\":\"ITA\"}]}".getBytes(StandardCharsets.UTF_8));
        StringBuilder hash=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest("/api/photos/widget-fixture".getBytes(StandardCharsets.UTF_8)))hash.append(String.format(Locale.ROOT,"%02x",b));
        Bitmap fixture=Bitmap.createBitmap(200,100,Bitmap.Config.ARGB_8888);fixture.eraseColor(Color.rgb(60,150,100));
        try(OutputStream out=new FileOutputStream(new File(dir,hash+".photo"))){fixture.compress(Bitmap.CompressFormat.PNG,100,out);}
        AppWidgetManager manager=AppWidgetManager.getInstance(c);AppWidgetHost host=new AppWidgetHost(c,4801);int id=host.allocateAppWidgetId();
        check(manager.bindAppWidgetIdIfAllowed(id,new ComponentName(c,MapWidgetProvider.class)),"Widget binding permission");
        try {
            Bundle size=new Bundle();size.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,320);size.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,300);manager.updateAppWidgetOptions(id,size);
            MapWidgetProvider.select(c,id,"world");MapWidgetProvider.refresh(c);
            View world=inflate(test,c,MapWidgetProvider.render(c,id));
            Bitmap map=((BitmapDrawable)((ImageView)world.findViewById(R.id.widget_map)).getDrawable()).getBitmap();
            check(Color.alpha(map.getPixel(0,0))==0,"Ocean is transparent");
            check(((LinearLayout)world.findViewById(R.id.widget_grid)).getChildCount()==MapWidgetProvider.ROWS,"Tap rows rendered");
            // Exercise real immutable PendingIntent dispatch to the registered provider.
            View target=null;LinearLayout grid=world.findViewById(R.id.widget_grid);
            for(int r=0;r<grid.getChildCount();r++){LinearLayout row=(LinearLayout)grid.getChildAt(r);for(int col=0;col<row.getChildCount();col++){View cell=row.getChildAt(col);if("Brazil".contentEquals(cell.getContentDescription()==null?"":cell.getContentDescription()))target=cell;}}
            check(target!=null,"Country tap target exists");final View countryTap=target;test.runOnMainSync(()->countryTap.performClick());
            for(int attempt=0;attempt<30&&!MapWidgetProvider.state(c).getString(MapWidgetProvider.key(id),"").equals("BRA");attempt++)Thread.sleep(100);
            check(MapWidgetProvider.state(c).getString(MapWidgetProvider.key(id),"").equals("BRA"),"Country tap selected Brazil");
            MapWidgetProvider.select(c,id,"HRV");MapWidgetProvider.update(c,id);
            View country=inflate(test,c,MapWidgetProvider.render(c,id));
            check(((TextView)country.findViewById(R.id.widget_title)).getText().toString().equals("Croatia"),"Fitted country title");
            check(country.findViewById(R.id.widget_photo).getVisibility()==View.VISIBLE,"Offline photo displayed");
            check(((ImageView)country.findViewById(R.id.widget_photo)).getDrawable()!=null,"Offline image decoded");
            check(MapWidgetProvider.state(c).getString(MapWidgetProvider.key(id+1),"").isEmpty(),"Widgets have independent selections");
            test.runOnMainSync(()->{
                country.measure(View.MeasureSpec.makeMeasureSpec(960,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(900,View.MeasureSpec.EXACTLY));country.layout(0,0,960,900);
                Bitmap screenshot=Bitmap.createBitmap(960,900,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(screenshot);canvas.drawColor(0xff253c37);country.draw(canvas);
                try(OutputStream output=new FileOutputStream(new File(c.getCacheDir(),"widget-preview.png"))){screenshot.compress(Bitmap.CompressFormat.PNG,100,output);}catch(Exception e){throw new RuntimeException(e);}
            });
            MapWidgetProvider.select(c,id,"next");check(MapWidgetProvider.state(c).getString(MapWidgetProvider.key(id),"").equals("ITA"),"Next saved country");
            View missing=inflate(test,c,MapWidgetProvider.render(c,id));check(missing.findViewById(R.id.widget_photo).getVisibility()==View.GONE,"Missing offline photo handled");
            size.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,180);size.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,180);manager.updateAppWidgetOptions(id,size);MapWidgetProvider.update(c,id);
            // Authentication removal must hide photos even before cache deletion completes.
            c.getSharedPreferences("worldwide",0).edit().remove("cookie").commit();MapWidgetProvider.select(c,id,"HRV");
            View signedOut=inflate(test,c,MapWidgetProvider.render(c,id));check(signedOut.findViewById(R.id.widget_photo).getVisibility()==View.GONE,"Sign-out hides cached photo");
            MapWidgetProvider.clear(c);check(MapWidgetProvider.state(c).getAll().isEmpty(),"Sign-out clears widget selections");
        }finally{host.deleteHost();c.getSharedPreferences("worldwide",0).edit().clear().commit();for(File file:dir.listFiles())file.delete();}
    }
}
