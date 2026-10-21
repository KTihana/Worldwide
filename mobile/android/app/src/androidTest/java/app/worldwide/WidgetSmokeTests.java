package app.worldwide;

import android.app.Instrumentation;
import android.appwidget.*;
import android.content.*;
import android.content.res.Configuration;
import android.graphics.*;
import android.graphics.drawable.BitmapDrawable;
import android.os.Bundle;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Locale;

/** Disposable offline tests. The coastal scenery and wallpapers are synthetic Canvas art. */
public class WidgetSmokeTests {
    private static final JSONArray previews=new JSONArray();
    static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
    private static Context fontContext(Context c,float scale){
        Configuration config=new Configuration(c.getResources().getConfiguration());config.fontScale=scale;
        return c.createConfigurationContext(config);
    }
    // Use actual density-scaled pixels: fixed 960px canvases distort dp-based layouts.
    private static View render(Instrumentation test,Context c,int id,int widthDp,int heightDp,boolean lightInk)throws Exception {
        RemoteViews remote=MapWidgetProvider.renderForSize(c,id,widthDp,heightDp,lightInk);final View[] result={null};
        test.runOnMainSync(()->{
            View view=remote.apply(c,new FrameLayout(c));float density=c.getResources().getDisplayMetrics().density;
            int width=Math.round(widthDp*density),height=Math.round(heightDp*density);
            view.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.EXACTLY));view.layout(0,0,width,height);result[0]=view;
        });return result[0];
    }
    private static boolean visible(View root,int id){
        View child=root.findViewById(id);if(child==null)return false;
        for(View current=child;current!=null;){
            if(current.getVisibility()!=View.VISIBLE)return false;if(current==root)return true;
            ViewParent parent=current.getParent();current=parent instanceof View?(View)parent:null;
        }return false;
    }
    private static void minimalChrome(Context c,View root){
        for(String name:new String[]{"widget_subtitle","widget_back","widget_hint","widget_open","widget_empty_text"}){
            int id=c.getResources().getIdentifier(name,"id",c.getPackageName());
            check(id==0||!visible(root,id),"Simplified widget omits "+name);
        }
        check(visible(root,R.id.widget_next),"Next remains available in the header");
        View title=root.findViewById(R.id.widget_title),next=root.findViewById(R.id.widget_next);
        check(title.getParent()==next.getParent(),"Title and next share the header");
    }
    private static Bitmap bitmap(View root,int id){
        ImageView view=root.findViewById(id);check(view!=null&&view.getDrawable() instanceof BitmapDrawable,"Bitmap exists for view "+id);
        return ((BitmapDrawable)view.getDrawable()).getBitmap();
    }
    private static String text(View root,int id){return ((TextView)root.findViewById(id)).getText().toString();}
    private static void layoutFits(View root,int id,String label){
        if(!visible(root,id))return;View child=root.findViewById(id);check(child.getWidth()>0&&child.getHeight()>0,label+" has visible area");
        Rect bounds=new Rect(0,0,child.getWidth(),child.getHeight());((ViewGroup)root).offsetDescendantRectToMyCoords(child,bounds);
        check(bounds.left>=0&&bounds.top>=0&&bounds.right<=root.getWidth()&&bounds.bottom<=root.getHeight(),label+" stays inside widget: "+bounds);
    }
    private static void transparentMap(Bitmap map,String label){
        check(Color.alpha(map.getPixel(0,0))==0,label+" leaves ocean transparent");int clear=0,total=0;
        for(int y=0;y<map.getHeight();y+=5)for(int x=0;x<map.getWidth();x+=5){total++;if(Color.alpha(map.getPixel(x,y))==0)clear++;}
        check(clear>total/8,label+" exposes wallpaper around geography");
    }
    private static long fingerprint(Bitmap image){
        long value=1;for(int y=0;y<image.getHeight();y++)for(int x=0;x<image.getWidth();x++)value=31*value+image.getPixel(x,y);return value;
    }
    private static void click(Instrumentation test,View root,int id){
        check(visible(root,id),"Tapped control is visible");test.runOnMainSync(()->check(root.findViewById(id).performClick(),"Control dispatches PendingIntent"));
    }
    private static void waitForCountry(Context c,int id,String expected)throws Exception {
        for(int n=0;n<40;n++){if(expected.equals(MapWidgetProvider.state(c).getString(MapWidgetProvider.key(id),"")))return;Thread.sleep(50);}
        check(false,"Country tap selects "+expected);
    }
    private static void waitForPhoto(Context c,int id,int expected)throws Exception {
        for(int n=0;n<40;n++){if(expected==MapWidgetProvider.state(c).getInt("photo-"+id,0))return;Thread.sleep(50);}
        check(false,"Photo tap advances to "+expected);
    }
    private static void transitions(Instrumentation test,Context c,int id)throws Exception {
        MapWidgetProvider.select(c,id,"world");
        RemoteViews world=MapWidgetProvider.renderForSize(c,id,320,300,true);
        MapWidgetProvider.select(c,id,"HRV");
        RemoteViews detail=MapWidgetProvider.renderForSize(c,id,320,300,true);
        boolean motion=MapWidgetProvider.motionEnabled(c);
        test.runOnMainSync(()->{
            View root=world.apply(c,new FrameLayout(c));ViewFlipper stage=root.findViewById(R.id.widget_stage);
            check(stage.getDisplayedChild()==0,"Transition starts on world");
            check(!stage.isAutoStart()&&!stage.isFlipping(),"Widget never loops while idle");
            // Reapply to the existing hosted view: replacing the root cannot demonstrate a transition.
            detail.reapply(c,root);check(stage.getDisplayedChild()==1,"Existing world view transitions to country");
            if(motion){
                check(stage.getInAnimation()!=null&&stage.getOutAnimation()!=null,"Enabled motion supplies enter and exit effects");
                check(stage.getInAnimation().getDuration()==180&&stage.getOutAnimation().getDuration()==180,"Transition lasts a finite 180ms");
                check(stage.getInAnimation().getRepeatCount()==0&&stage.getOutAnimation().getRepeatCount()==0,"Transition effects never repeat");
                check(stage.getCurrentView().getAnimation()!=null,"Reapplied country receives enter animation");
            }else check(stage.getInAnimation()==null&&stage.getOutAnimation()==null,"System reduced-motion setting selects static rendering");
            world.reapply(c,root);check(stage.getDisplayedChild()==0&&!stage.isFlipping(),"Return transition ends at world without autoplay");
            // Verify the exact fallback independently of this emulator's animation preference.
            RemoteViews staticWorld=new RemoteViews(c.getPackageName(),R.layout.map_widget_static);
            staticWorld.setDisplayedChild(R.id.widget_stage,0);View staticRoot=staticWorld.apply(c,new FrameLayout(c));
            RemoteViews staticDetail=new RemoteViews(c.getPackageName(),R.layout.map_widget_static);staticDetail.setDisplayedChild(R.id.widget_stage,1);staticDetail.reapply(c,staticRoot);
            ViewFlipper staticStage=staticRoot.findViewById(R.id.widget_stage);
            check(staticStage.getDisplayedChild()==1,"Static fallback changes to country");
            check(staticStage.getInAnimation()==null&&staticStage.getOutAnimation()==null&&staticStage.getCurrentView().getAnimation()==null,"Static fallback has no animation");
            check(!staticStage.isAutoStart()&&!staticStage.isFlipping(),"Static fallback has no idle motion");
        });
        MapWidgetProvider.select(c,id,"world");
    }
    private static void wallpaper(Canvas canvas,String style,int width,int height){
        Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
        if(style.equals("light")){
            paint.setShader(new LinearGradient(0,0,width,height,0xfff9f4df,0xffc5dfde,Shader.TileMode.CLAMP));canvas.drawRect(0,0,width,height,paint);
        }else if(style.equals("busy")){
            paint.setShader(new LinearGradient(0,0,width,height,0xff153a49,0xff9a5c72,Shader.TileMode.CLAMP));canvas.drawRect(0,0,width,height,paint);paint.setShader(null);
            for(int i=0;i<15;i++){paint.setColor(new int[]{0x886fd2cc,0x887eaa54,0x888d9bd8,0x88522152}[i%4]);float x=(i*137%401)/400f*width,y=(i*97%307)/306f*height;canvas.drawCircle(x,y,width*(.10f+(i%4)*.035f),paint);}
        }else{
            paint.setShader(new LinearGradient(0,0,width,height,0xff294d4d,0xff091d29,Shader.TileMode.CLAMP));canvas.drawRect(0,0,width,height,paint);paint.setShader(null);paint.setColor(0x183da58a);canvas.drawCircle(width*.9f,height*.8f,width*.65f,paint);
        }
    }
    private static void preview(Instrumentation test,Context c,View root,String name,int widthDp,int heightDp,String wallpaper)throws Exception {
        for(int id:new int[]{R.id.widget_title,R.id.widget_next,R.id.widget_photo,R.id.widget_country_map})layoutFits(root,id,"Preview "+name+" view "+id);
        test.runOnMainSync(()->{
            Bitmap layer=Bitmap.createBitmap(root.getWidth(),root.getHeight(),Bitmap.Config.ARGB_8888);root.draw(new Canvas(layer));
            check(Color.alpha(layer.getPixel(0,0))==0,"Widget root preserves wallpaper in "+name);
            Bitmap screenshot=Bitmap.createBitmap(root.getWidth(),root.getHeight(),Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(screenshot);wallpaper(canvas,wallpaper,screenshot.getWidth(),screenshot.getHeight());canvas.drawBitmap(layer,0,0,null);
            try(OutputStream out=new FileOutputStream(new File(c.getCacheDir(),"widget-"+name+".png"))){check(screenshot.compress(Bitmap.CompressFormat.PNG,100,out),"Screenshot written");}catch(IOException error){throw new RuntimeException(error);}layer.recycle();screenshot.recycle();
        });
        previews.put(new JSONObject().put("name",name).put("widthDp",widthDp).put("heightDp",heightDp).put("widthPx",root.getWidth()).put("heightPx",root.getHeight()).put("density",c.getResources().getDisplayMetrics().density).put("fontScale",c.getResources().getConfiguration().fontScale).put("wallpaper",wallpaper));
    }
    /** Invented Adriatic scenery, made locally without real personal images or network requests. */
    private static Bitmap scenery(boolean sunset){
        Bitmap image=Bitmap.createBitmap(960,640,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(image);Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setShader(new LinearGradient(0,0,0,390,sunset?0xff66678a:0xff5eabc4,sunset?0xfffac790:0xffd8e5dd,Shader.TileMode.CLAMP));canvas.drawRect(0,0,960,390,p);p.setShader(null);
        p.setColor(sunset?0xffffdf9d:0xfff4ebce);canvas.drawCircle(sunset?720:210,155,sunset?53:35,p);
        Path far=new Path();far.moveTo(0,365);far.lineTo(0,300);far.cubicTo(130,300,170,205,290,285);far.cubicTo(440,190,550,320,680,270);far.cubicTo(790,240,880,305,960,275);far.lineTo(960,390);far.close();p.setColor(sunset?0xff8d7f8c:0xff8baeb1);canvas.drawPath(far,p);
        p.setShader(new LinearGradient(0,340,0,640,sunset?0xff9b92a3:0xff5ba9b7,sunset?0xff426f86:0xff226b7a,Shader.TileMode.CLAMP));canvas.drawRect(0,345,960,640,p);p.setShader(null);
        for(int i=0;i<47;i++){float y=359+i*6,x=(i*137%960);p.setColor(sunset?0x40fbe2bf:0x40cce7df);p.setStrokeWidth(1+(i%3));canvas.drawLine(x,y,Math.min(960,x+32+(i*13%110)),y,p);}
        Path coast=new Path();coast.moveTo(0,415);coast.cubicTo(175,365,225,425,335,455);coast.cubicTo(480,489,535,552,650,640);coast.lineTo(0,640);coast.close();p.setColor(sunset?0xff85816d:0xffc6c1a4);canvas.drawPath(coast,p);
        Path green=new Path();green.moveTo(0,410);green.cubicTo(120,365,220,412,305,445);green.cubicTo(390,472,445,540,460,640);green.lineTo(0,640);green.close();p.setColor(0xff48664e);canvas.drawPath(green,p);
        for(int i=0;i<9;i++){int x=60+i*28,y=405+(i%3)*15;p.setColor(i%2==0?0xffe7d6b8:0xffcbbd9f);canvas.drawRect(x,y,x+25,y+42,p);Path roof=new Path();roof.moveTo(x-4,y);roof.lineTo(x+12,y-13);roof.lineTo(x+29,y);roof.close();p.setColor(0xffaa6b52);canvas.drawPath(roof,p);p.setColor(0xff516368);canvas.drawRect(x+9,y+16,x+15,y+26,p);}
        p.setColor(0xff233e38);p.setStrokeWidth(7);canvas.drawLine(77,586,90,330,p);canvas.drawLine(90,402,36,365,p);canvas.drawLine(90,380,155,350,p);
        for(int i=0;i<9;i++){p.setColor(i%2==0?0xff294d42:0xff365c49);canvas.drawOval(10+(i*41%150),308+(i*29%100),90+(i*41%150),348+(i*29%100),p);}
        p.setColor(0xffeee8d7);Path sail=new Path();sail.moveTo(713,423);sail.lineTo(713,474);sail.lineTo(749,474);sail.close();canvas.drawPath(sail,p);p.setColor(0xff314956);p.setStrokeWidth(2);canvas.drawLine(711,418,711,485,p);canvas.drawLine(700,482,749,482,p);return image;
    }
    private static void savePhoto(File dir,String id,boolean sunset)throws Exception {
        StringBuilder name=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(("/api/photos/"+id).getBytes(StandardCharsets.UTF_8)))name.append(String.format(Locale.ROOT,"%02x",b));
        Bitmap image=scenery(sunset);try(OutputStream out=new FileOutputStream(new File(dir,name+".photo"))){image.compress(Bitmap.CompressFormat.PNG,100,out);}finally{image.recycle();}
    }
    public static void run(Instrumentation test)throws Exception {
        Context c=test.getTargetContext();check(c.getPackageName().equals("app.worldwide.widgettest"),"Only disposable test package allowed");
        File dir=new File(c.getFilesDir(),"album");check(dir.mkdirs()||dir.isDirectory(),"Disposable album directory exists");MapWidgetProvider.state(c).edit().clear().commit();c.getSharedPreferences("worldwide",0).edit().putString("cookie","synthetic-widget-fixture").commit();
        JSONObject album=new JSONObject().put("photos",new JSONArray()
            .put(new JSONObject().put("id","widget-sunset").put("countryId","HRV").put("caption","Evening on the water").put("createdAt","2024-06-13T19:30:00Z"))
            .put(new JSONObject().put("id","widget-coast").put("countryId","HRV").put("caption","Along the coast").put("createdAt","2024-06-12T12:00:00Z"))
            .put(new JSONObject().put("id","widget-japan").put("countryId","JPN").put("caption","A quiet evening"))
            .put(new JSONObject().put("id","missing").put("countryId","ITA").put("caption","An Italian summer")))
            .put("visits",new JSONArray().put(new JSONObject().put("countryId","HRV").put("visited",true).put("coverId","widget-coast").put("visitDate","2024-06-12")));
        Files.write(new File(dir,"atlas.json").toPath(),album.toString().getBytes(StandardCharsets.UTF_8));savePhoto(dir,"widget-coast",false);savePhoto(dir,"widget-sunset",true);savePhoto(dir,"widget-japan",true);
        AppWidgetManager manager=AppWidgetManager.getInstance(c);AppWidgetHost host=new AppWidgetHost(c,4801);int id=host.allocateAppWidgetId(),other=host.allocateAppWidgetId();
        try {
            ComponentName provider=new ComponentName(c,MapWidgetProvider.class);check(manager.bindAppWidgetIdIfAllowed(id,provider),"Widget binding permission");check(manager.bindAppWidgetIdIfAllowed(other,provider),"Second widget binding permission");
            Bundle size=new Bundle();size.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,320);size.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH,320);size.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,300);size.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,300);manager.updateAppWidgetOptions(id,size);
            MapWidgetProvider.select(c,id,"world");MapWidgetProvider.refresh(c);View world=render(test,c,id,320,300,true);
            check(text(world,R.id.widget_title).equals("Earth"),"World title is Earth");transparentMap(bitmap(world,R.id.widget_map),"World map");check(visible(world,R.id.widget_map)&&!visible(world,R.id.widget_photo),"World shows the map rather than the detail photo view");
            minimalChrome(c,world);
            // Removing only locally available image files must change the map artwork itself.
            File[] cachedFiles=dir.listFiles((folder,name)->name.endsWith(".photo"));check(cachedFiles!=null,"Photo fixture directory readable");
            for(File file:cachedFiles)check(file.renameTo(new File(file.getPath()+".held")),"Temporarily hide fixture photo");
            long withoutPictures;
            try{withoutPictures=fingerprint(bitmap(render(test,c,id,320,300,true),R.id.widget_map));}
            finally{for(File file:cachedFiles)check(new File(file.getPath()+".held").renameTo(file),"Restore fixture photo");}
            check(fingerprint(bitmap(world,R.id.widget_map))!=withoutPictures,"Earth map visibly includes available country photos");
            LinearLayout grid=world.findViewById(R.id.widget_grid);check(grid.getChildCount()==MapWidgetProvider.ROWS,"Country tap rows rendered");preview(test,c,world,"world",320,300,"dark");transitions(test,c,id);
            // Exercise real immutable PendingIntent dispatch through the registered provider.
            View target=null;for(int r=0;r<grid.getChildCount();r++){LinearLayout row=(LinearLayout)grid.getChildAt(r);for(int col=0;col<row.getChildCount();col++){View cell=row.getChildAt(col);if("Brazil".contentEquals(cell.getContentDescription()==null?"":cell.getContentDescription()))target=cell;}}
            check(target!=null,"Brazil has a tap target");final View countryTap=target;test.runOnMainSync(()->check(countryTap.performClick(),"Map country dispatches click"));waitForCountry(c,id,"BRA");MapWidgetProvider.select(c,id,"NOT_A_COUNTRY");waitForCountry(c,id,"BRA");
            MapWidgetProvider.select(c,other,"JPN");MapWidgetProvider.select(c,id,"HRV");MapWidgetProvider.update(c,id);View country=render(test,c,id,320,300,true);
            check(text(country,R.id.widget_title).equals("Croatia"),"Country title identifies selected place");check(MapWidgetProvider.photos(album,"HRV").get(0).getString("id").equals("widget-coast"),"Chosen cover leads the photo sequence");minimalChrome(c,country);check(visible(country,R.id.widget_photo),"Cached personal photo displayed offline");check(visible(country,R.id.widget_country_map),"Country silhouette supplies geographic context");transparentMap(bitmap(country,R.id.widget_country_map),"Country map");long first=fingerprint(bitmap(country,R.id.widget_photo));
            check(MapWidgetProvider.state(c).getString(MapWidgetProvider.key(other),"").equals("JPN"),"Widgets keep independent selections");preview(test,c,country,"country",320,300,"dark");
            click(test,country,R.id.widget_photo);waitForPhoto(c,id,1);View second=render(test,c,id,320,300,true);check(fingerprint(bitmap(second,R.id.widget_photo))!=first,"Photo tap displays a different cached photo");click(test,second,R.id.widget_photo);waitForPhoto(c,id,0);check(fingerprint(bitmap(render(test,c,id,320,300,true),R.id.widget_photo))==first,"Photo cycling wraps without losing the cover");
            View compact=render(test,c,id,220,220,true);preview(test,c,compact,"compact",220,220,"dark");check(visible(compact,R.id.widget_photo),"Compact widget retains the photo");
            preview(test,c,render(test,c,id,400,220,true),"wide",400,220,"dark");preview(test,c,render(test,c,id,320,300,false),"light",320,300,"light");preview(test,c,render(test,c,id,320,300,true),"busy",320,300,"busy");
            Context largeText=fontContext(c,1.5f);View large=render(test,largeText,id,320,300,true);preview(test,largeText,large,"text-large",320,300,"dark");check(((TextView)large.findViewById(R.id.widget_title)).getTextSize()>((TextView)country.findViewById(R.id.widget_title)).getTextSize(),"Large-text configuration scales rendered text");
            click(test,country,R.id.widget_next);waitForCountry(c,id,"JPN");check(visible(render(test,c,id,320,300,true),R.id.widget_photo),"Next country has a cached memory");MapWidgetProvider.select(c,id,"ITA");View missing=render(test,c,id,320,300,true);check(!visible(missing,R.id.widget_photo),"Missing cache never shows stale photo");check(visible(missing,R.id.widget_empty_map),"Missing cache keeps the country map");minimalChrome(c,missing);preview(test,c,missing,"empty",320,300,"dark");
            click(test,missing,R.id.widget_title);waitForCountry(c,id,"");View returned=render(test,c,id,320,300,true);check(visible(returned,R.id.widget_map)&&!visible(returned,R.id.widget_photo),"Title returns to Earth without stale detail photo");
            MapWidgetProvider.Country longest=null;for(MapWidgetProvider.Country item:MapWidgetProvider.countries(c))if(longest==null||item.name.length()>longest.name.length())longest=item;
            check(longest!=null,"Country catalogue available");MapWidgetProvider.select(c,id,longest.id);View longCountry=render(test,largeText,id,220,220,true);check(text(longCountry,R.id.widget_title).equals(longest.name),"Long name retained for accessibility");check(visible(longCountry,R.id.widget_empty_map),"Country without photos keeps map");preview(test,largeText,longCountry,"long-country",220,220,"dark");
            Bitmap island=bitmap(longCountry,R.id.widget_empty_map);int islandPixels=0;for(int y=0;y<island.getHeight();y++)for(int x=0;x<island.getWidth();x++)if(Color.alpha(island.getPixel(x,y))>100)islandPixels++;
            check(islandPixels>100,"Scattered islands remain visible: "+islandPixels+" pixels at "+island.getWidth()+"x"+island.getHeight());
            // An unsaved cover must not make downloaded photos unreachable.
            JSONObject partial=new JSONObject(album.toString());partial.getJSONArray("photos").put(new JSONObject().put("id","unsaved-cover").put("countryId","HRV"));partial.getJSONArray("visits").getJSONObject(0).put("coverId","unsaved-cover");
            Files.write(new File(dir,"atlas.json").toPath(),partial.toString().getBytes(StandardCharsets.UTF_8));MapWidgetProvider.select(c,id,"HRV");View partialCover=render(test,c,id,320,300,true);
            check(visible(partialCover,R.id.widget_photo),"Unsaved cover falls back to an available offline memory");
            Files.write(new File(dir,"atlas.json").toPath(),album.toString().getBytes(StandardCharsets.UTF_8));
            // With only Croatia in the device-owned album, Next must reveal Croatia and its photo.
            JSONObject croatiaOnly=new JSONObject(album.toString());JSONArray croatianPhotos=new JSONArray();
            for(JSONObject item:MapWidgetProvider.photos(album,"HRV"))croatianPhotos.put(item);croatiaOnly.put("photos",croatianPhotos);
            Files.write(new File(dir,"atlas.json").toPath(),croatiaOnly.toString().getBytes(StandardCharsets.UTF_8));
            MapWidgetProvider.select(c,id,"world");View onlyEarth=render(test,c,id,320,300,true);click(test,onlyEarth,R.id.widget_next);waitForCountry(c,id,"HRV");
            View onlyCroatia=render(test,c,id,320,300,true);check(text(onlyCroatia,R.id.widget_title).equals("Croatia")&&visible(onlyCroatia,R.id.widget_photo),"Only photographed country appears with its photo on Next");
            click(test,onlyCroatia,R.id.widget_next);waitForCountry(c,id,"HRV");check(visible(render(test,c,id,320,300,true),R.id.widget_photo),"Next stays with photographed country instead of empty destinations");
            Files.write(new File(dir,"atlas.json").toPath(),album.toString().getBytes(StandardCharsets.UTF_8));
            // Disconnecting sync does not remove or hide the device-owned album.
            MapWidgetProvider.select(c,id,"HRV");c.getSharedPreferences("worldwide",0).edit().remove("cookie").commit();check(visible(render(test,c,id,320,300,true),R.id.widget_photo),"Disconnect preserves device-owned photos without an account");
            new MapWidgetProvider().onDeleted(c,new int[]{id});check(!MapWidgetProvider.state(c).contains(MapWidgetProvider.key(id))&&!MapWidgetProvider.state(c).contains("photo-"+id),"Removing widget clears its selection");check(MapWidgetProvider.state(c).getString(MapWidgetProvider.key(other),"").equals("JPN"),"Removing one widget preserves other");MapWidgetProvider.clear(c);check(MapWidgetProvider.state(c).getAll().isEmpty(),"Explicit widget reset clears all widget state");
            Files.write(new File(c.getCacheDir(),"widget-previews.json").toPath(),new JSONObject().put("fixture","Synthetic coastal illustration and wallpapers, created by Android Canvas for tests; no real personal photos or network requests.").put("previews",previews).toString(2).getBytes(StandardCharsets.UTF_8));
        }finally{host.deleteHost();MapWidgetProvider.state(c).edit().clear().commit();c.getSharedPreferences("worldwide",0).edit().clear().commit();File[] files=dir.listFiles();if(files!=null)for(File file:files)check(file.delete(),"Disposable fixture removed: "+file.getName());}
    }
}
