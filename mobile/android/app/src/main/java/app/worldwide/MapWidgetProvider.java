package app.worldwide;

import android.app.PendingIntent;
import android.app.WallpaperManager;
import android.app.WallpaperColors;
import android.os.Build;
import android.provider.Settings;
import android.util.SizeF;
import android.util.TypedValue;
import android.text.TextPaint;
import android.text.StaticLayout;
import android.text.Layout;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.*;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import androidx.core.graphics.PathParser;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;

/** Offline-only home-screen view. No album files are exposed through a provider. */
public class MapWidgetProvider extends AppWidgetProvider {
    static final int COLS=24, ROWS=12;
    private static final String ACTION="app.worldwide.WIDGET_TAP";
    private static List<Country> countries;
    private static final ExecutorService WORKER=Executors.newSingleThreadExecutor();
    static final class Country {
        final String id,name; final Path path; final RectF bounds;
        Country(JSONObject value)throws Exception {
            id=value.getString("id");name=value.getString("name");
            path=PathParser.createPathFromPathData(value.getString("path"));
            JSONArray b=value.getJSONArray("bounds");bounds=new RectF((float)b.getDouble(0),(float)b.getDouble(1),(float)b.getDouble(2),(float)b.getDouble(3));
        }
    }
    static synchronized List<Country> countries(Context context)throws Exception {
        if(countries==null){
            List<Country> loaded=new ArrayList<>();
            try(InputStream input=context.getAssets().open("widget-world.json")){
                ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[16384];int count;while((count=input.read(buffer))!=-1)bytes.write(buffer,0,count);
                JSONArray data=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8)).getJSONArray("countries");
                for(int i=0;i<data.length();i++)loaded.add(new Country(data.getJSONObject(i)));
            }
            countries=loaded;
        }
        return countries;
    }
    static SharedPreferences state(Context c){return c.getSharedPreferences("map-widgets",0);}
    static String key(int id){return "country-"+id;}
    static JSONObject album(Context c){
        if(c.getSharedPreferences("worldwide",0).getString("cookie","").isEmpty())return new JSONObject();
        try{return new JSONObject(new String(Files.readAllBytes(new File(c.getFilesDir(),"album/atlas.json").toPath()),StandardCharsets.UTF_8));}catch(Exception e){return new JSONObject();}
    }
    static List<JSONObject> photos(JSONObject album,String country){
        List<JSONObject> result=new ArrayList<>();JSONArray all=album.optJSONArray("photos");
        if(all!=null)for(int i=0;i<all.length();i++){JSONObject photo=all.optJSONObject(i);if(photo!=null&&country.equals(photo.optString("countryId")))result.add(photo);}
        JSONArray visits=album.optJSONArray("visits");
        if(visits!=null)for(int i=0;i<visits.length();i++){
            JSONObject visit=visits.optJSONObject(i);if(visit==null||!country.equals(visit.optString("countryId")))continue;
            String cover=visit.optString("coverId","");
            for(int j=0;j<result.size();j++)if(cover.equals(result.get(j).optString("id"))){JSONObject first=result.remove(j);result.add(0,first);break;}
        }
        return result;
    }
    static boolean photoExists(Context c,JSONObject item){try{
        String id=item.getString("id");if(!id.matches("[a-zA-Z0-9_-]+"))return false;
        StringBuilder name=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(("/api/photos/"+id).getBytes(StandardCharsets.UTF_8)))name.append(String.format(Locale.ROOT,"%02x",b));
        return new File(c.getFilesDir(),"album/"+name+".photo").isFile();
    }catch(Exception ignored){return false;}}
    static Bitmap photo(Context c,JSONObject item){try{
        String id=item.getString("id");if(!id.matches("[a-zA-Z0-9_-]+"))return null;
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(("/api/photos/"+id).getBytes(StandardCharsets.UTF_8));StringBuilder name=new StringBuilder();for(byte b:digest)name.append(String.format(Locale.ROOT,"%02x",b));
        String path=new File(c.getFilesDir(),"album/"+name+".photo").getPath();
        BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeFile(path,options);
        if(options.outWidth<=0||options.outHeight<=0)return null;
        options.inSampleSize=1;while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>640)options.inSampleSize*=2;
        options.inJustDecodeBounds=false;return BitmapFactory.decodeFile(path,options);
    }catch(Exception e){return null;}}
    private static PendingIntent tap(Context c,int id,String action){
        Intent intent=new Intent(c,MapWidgetProvider.class).setAction(ACTION).setData(Uri.parse("worldwide-widget://"+id+"/"+action)).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id).putExtra("tap",action);
        return PendingIntent.getBroadcast(c,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    @Override public void onReceive(Context c,Intent intent){
        if(ACTION.equals(intent.getAction())){
            int id=intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,-1);
            if(!contains(AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,MapWidgetProvider.class)),id))return;
            enqueue(c,new int[]{id},intent.getStringExtra("tap"));return;
        }
        if(Intent.ACTION_WALLPAPER_CHANGED.equals(intent.getAction())){
            enqueue(c,AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,MapWidgetProvider.class)),null);return;
        }
        super.onReceive(c,intent);
    }
    private void enqueue(Context context,int[] ids,String action){
        Context app=context.getApplicationContext();PendingResult pending=goAsync();
        WORKER.execute(()->{try{for(int id:ids){if(action!=null)select(app,id,action);update(app,id);}}finally{if(pending!=null)pending.finish();}});
    }
    private static boolean contains(int[] values,int value){for(int n:values)if(n==value)return true;return false;}
    static synchronized void select(Context c,int id,String action){try{
        if(action==null)return;SharedPreferences prefs=state(c);String selected=prefs.getString(key(id),"");
        if(action.equals("photo")){prefs.edit().putInt("photo-"+id,(prefs.getInt("photo-"+id,0)+1)%Math.max(1,photos(album(c),selected).size())).apply();return;}
        if(action.equals("world"))selected="";
        else if(action.equals("next")){
            List<Country> all=countries(c),choices=new ArrayList<>();JSONObject data=album(c);
            for(Country country:all)if(!photos(data,country.id).isEmpty())choices.add(country);
            List<Country> cached=new ArrayList<>();
            for(Country country:choices)for(JSONObject image:photos(data,country.id))if(photoExists(c,image)){cached.add(country);break;}
            if(!cached.isEmpty())choices=cached;
            if(choices.isEmpty())choices=all;
            int at=-1;for(int i=0;i<choices.size();i++)if(choices.get(i).id.equals(selected))at=i;
            selected=choices.get((at+1)%choices.size()).id;
        }else {boolean valid=false;for(Country country:countries(c))if(country.id.equals(action)){valid=true;break;}if(!valid)return;selected=action;}
        prefs.edit().putString(key(id),selected).putInt("photo-"+id,0).apply();
    }catch(Exception ignored){}}
    @Override public void onUpdate(Context c,AppWidgetManager manager,int[] ids){enqueue(c,ids,null);}
    @Override public void onAppWidgetOptionsChanged(Context c,AppWidgetManager manager,int id,Bundle options){enqueue(c,new int[]{id},null);}
    @Override public void onDeleted(Context c,int[] ids){SharedPreferences.Editor edit=state(c).edit();for(int id:ids)edit.remove(key(id)).remove("photo-"+id);edit.apply();}
    static synchronized void refresh(Context c){for(int id:AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,MapWidgetProvider.class)))update(c,id);}
    static synchronized void clear(Context c){state(c).edit().clear().commit();refresh(c);}
    static synchronized void update(Context c,int id){
        try{AppWidgetManager.getInstance(c).updateAppWidget(id,responsive(c,id));}
        catch(Exception e){
            android.util.Log.e("WorldwideWidget","Could not draw map",e);
            RemoteViews fallback=new RemoteViews(c.getPackageName(),R.layout.map_widget_static);
            fallback.setTextViewText(R.id.widget_title,"Your world");fallback.setTextViewText(R.id.widget_subtitle,"Open Worldwide to refresh");
            fallback.setOnClickPendingIntent(R.id.widget_open,open(c));
            AppWidgetManager.getInstance(c).updateAppWidget(id,fallback);
        }
    }
    private static PendingIntent open(Context c){return PendingIntent.getActivity(c,7401,new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    static boolean motionEnabled(Context c){
        try{return Settings.Global.getFloat(c.getContentResolver(),Settings.Global.ANIMATOR_DURATION_SCALE,1)>0&&Settings.Global.getFloat(c.getContentResolver(),Settings.Global.TRANSITION_ANIMATION_SCALE,1)>0;}catch(Exception ignored){return false;}
    }
    private static boolean lightInk(Context c){
        if(Build.VERSION.SDK_INT>=31)try{
            WallpaperColors colors=WallpaperManager.getInstance(c).getWallpaperColors(WallpaperManager.FLAG_SYSTEM);
            if(colors!=null)return (colors.getColorHints()&WallpaperColors.HINT_SUPPORTS_DARK_TEXT)==0;
        }catch(Exception ignored){}
        return true;
    }
    private static RemoteViews responsive(Context c,int id)throws Exception {
        Bundle options=AppWidgetManager.getInstance(c).getAppWidgetOptions(id);
        if(Build.VERSION.SDK_INT>=31){
            ArrayList<SizeF> sizes=options.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES);
            if(sizes!=null&&!sizes.isEmpty()){
                Map<SizeF,RemoteViews> layouts=new LinkedHashMap<>();
                // Bound bitmap memory even if a third-party launcher supplies excessive sizes.
                for(SizeF size:sizes){if(layouts.size()==4)break;if(size.getWidth()>0&&size.getHeight()>0)layouts.put(size,renderForSize(c,id,Math.round(size.getWidth()),Math.round(size.getHeight())));}
                if(!layouts.isEmpty())return new RemoteViews(layouts);
            }
        }
        int minWidth=options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,320),maxHeight=options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,300);
        int maxWidth=options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH,minWidth),minHeight=options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,maxHeight);
        RemoteViews portrait=renderForSize(c,id,minWidth,maxHeight);
        return minWidth==maxWidth&&minHeight==maxHeight?portrait:new RemoteViews(renderForSize(c,id,maxWidth,minHeight),portrait);
    }
    static synchronized RemoteViews render(Context c,int id)throws Exception {
        Bundle options=AppWidgetManager.getInstance(c).getAppWidgetOptions(id);
        return renderForSize(c,id,options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,320),options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,300));
    }
    static synchronized RemoteViews renderForSize(Context c,int id,int widthDp,int heightDp)throws Exception {return renderForSize(c,id,widthDp,heightDp,lightInk(c));}
    static synchronized RemoteViews renderForSize(Context c,int id,int widthDp,int heightDp,boolean lightInk)throws Exception {
        widthDp=Math.max(140,Math.min(1000,widthDp));heightDp=Math.max(140,Math.min(1000,heightDp));
        List<Country> all=countries(c);JSONObject data=album(c);String selected=state(c).getString(key(id),"");Country focus=null;
        for(Country country:all)if(country.id.equals(selected))focus=country;
        List<JSONObject> images=photos(data,selected);
        int index=Math.floorMod(state(c).getInt("photo-"+id,0),Math.max(1,images.size()));
        Bitmap picture=images.isEmpty()?null:photo(c,images.get(index));
        // A partially synced cover must not hide other memories already on the phone.
        if(picture==null)for(int offset=1;offset<images.size();offset++){
            int candidate=(index+offset)%images.size();Bitmap cached=photo(c,images.get(candidate));
            if(cached!=null){index=candidate;picture=cached;state(c).edit().putInt("photo-"+id,index).apply();break;}
        }
        Set<String> saved=new HashSet<>(),visited=new HashSet<>();JSONArray list=data.optJSONArray("photos"),visits=data.optJSONArray("visits");
        if(list!=null)for(int i=0;i<list.length();i++){JSONObject item=list.optJSONObject(i);if(item!=null)saved.add(item.optString("countryId"));}
        if(visits!=null)for(int i=0;i<visits.length();i++){JSONObject visit=visits.optJSONObject(i);if(visit!=null&&(visit.optInt("visited")==1||visit.optBoolean("visited")))visited.add(visit.optString("countryId"));}
        Set<String> places=new HashSet<>(visited);places.addAll(saved);
        boolean compact=heightDp<250||widthDp<250;
        String title=focus==null?"Your world":focus.name;
        String subtitle=focus==null?(places.isEmpty()?"Every place holds a story":quantity(places.size(),"place")+", "+quantity(list==null?0:list.length(),"memory","memories")):
            picture!=null&&!images.get(index).optString("caption","").trim().isEmpty()?images.get(index).optString("caption").trim():quantity(images.size(),"memory","memories");
        float titleSp=compact?22:26;
        float density=c.getResources().getDisplayMetrics().density,fontScale=c.getResources().getConfiguration().fontScale;
        TextPaint text=new TextPaint(Paint.ANTI_ALIAS_FLAG);text.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));text.setTextSize(titleSp*density*fontScale);text.setLetterSpacing(-.02f);
        StaticLayout lines=StaticLayout.Builder.obtain(title,0,title.length(),text,Math.max(1,Math.round((widthDp-80)*density))).setIncludePad(false).setEllipsize(android.text.TextUtils.TruncateAt.END).setMaxLines(compact?1:2).setAlignment(Layout.Alignment.ALIGN_NORMAL).build();
        float headerDp=Math.max(compact?48:56,lines.getHeight()/density+(compact?0:16*fontScale));
        float bodyWidth=Math.max(1,widthDp-24),bodyHeight=Math.max(1,heightDp-24-(compact&&Build.VERSION.SDK_INT>=31?16:24)-48-headerDp);
        // One common scale keeps geography undistorted, with a bounded binder bitmap budget.
        float renderScale=Math.min(2,Math.min(600/bodyWidth,480/bodyHeight));
        android.util.DisplayMetrics screen=c.getResources().getDisplayMetrics();
        renderScale=Math.min(renderScale,(float)Math.sqrt(screen.widthPixels*(double)screen.heightPixels*.16/(bodyWidth*bodyHeight)));
        int width=Math.max(1,Math.round(bodyWidth*renderScale)),height=Math.max(1,Math.round(bodyHeight*renderScale));
        WidgetArtwork.MapImage map=WidgetArtwork.world(all,saved,visited,width,height,lightInk);
        RemoteViews view=new RemoteViews(c.getPackageName(),motionEnabled(c)?R.layout.map_widget:R.layout.map_widget_static);
        view.setViewVisibility(R.id.widget_subtitle,compact?View.GONE:View.VISIBLE);
        view.setInt(R.id.widget_header,"setMinimumHeight",Math.round((compact?48:56)*density));
        if(Build.VERSION.SDK_INT>=31&&compact){view.setViewLayoutMargin(R.id.widget_stage,RemoteViews.MARGIN_TOP,8,TypedValue.COMPLEX_UNIT_DIP);view.setViewLayoutMargin(R.id.widget_stage,RemoteViews.MARGIN_BOTTOM,8,TypedValue.COMPLEX_UNIT_DIP);}
        if(!lightInk){
            view.setInt(R.id.widget_back,"setBackgroundResource",R.drawable.widget_light_control_ripple);view.setInt(R.id.widget_next,"setBackgroundResource",R.drawable.widget_light_control_ripple);
            view.setImageViewResource(R.id.widget_back,R.drawable.widget_chevron_left_dark);view.setImageViewResource(R.id.widget_next,R.drawable.widget_chevron_right_dark);
        }
        int primary=lightInk?0xfff4f7f5:0xff1e352b,secondary=lightInk?0xffd2ded7:0xff405a4c;
        view.setTextViewText(R.id.widget_title,title);view.setInt(R.id.widget_title,"setMaxLines",compact?1:2);view.setTextViewTextSize(R.id.widget_title,TypedValue.COMPLEX_UNIT_SP,titleSp);
        view.setTextViewText(R.id.widget_subtitle,subtitle);view.setTextColor(R.id.widget_title,primary);view.setTextColor(R.id.widget_subtitle,secondary);view.setTextColor(R.id.widget_hint,primary);view.setTextColor(R.id.widget_empty_text,secondary);
        view.setImageViewBitmap(R.id.widget_map,map.bitmap);view.setOnClickPendingIntent(R.id.widget_open,open(c));
        view.setOnClickPendingIntent(R.id.widget_back,tap(c,id,"world"));view.setOnClickPendingIntent(R.id.widget_next,tap(c,id,"next"));
        view.setOnClickPendingIntent(R.id.widget_hint,tap(c,id,focus==null?"next":"photo"));
        view.setContentDescription(R.id.widget_hint,focus==null?"Explore your memories":picture==null?"Explore next country":"Photo "+(index+1)+" of "+images.size()+". Tap for next photo");
        view.setViewVisibility(R.id.widget_back,focus==null?View.GONE:View.VISIBLE);
        view.setContentDescription(R.id.widget_next,saved.isEmpty()?"Explore next country":"Next country with memories");
        view.setTextViewText(R.id.widget_hint,focus==null?(saved.isEmpty()?"Explore countries":"Explore memories"):picture!=null?("Photo "+(index+1)+" of "+images.size()):"Next place");
        if(focus!=null&&picture==null)view.setOnClickPendingIntent(R.id.widget_hint,tap(c,id,"next"));
        view.setOnClickPendingIntent(R.id.widget_photo,tap(c,id,"photo"));
        view.setContentDescription(R.id.widget_photo,title+", photo "+(index+1)+" of "+images.size()+(images.size()>1?". Tap for next photo":""));
        view.setViewVisibility(R.id.widget_photo,picture==null?View.GONE:View.VISIBLE);
        view.setViewVisibility(R.id.widget_photo_scrim,picture==null?View.GONE:View.VISIBLE);
        view.setViewVisibility(R.id.widget_country_inset,picture==null||bodyHeight<64?View.GONE:View.VISIBLE);
        view.setViewVisibility(R.id.widget_empty_map,focus!=null&&picture==null?View.VISIBLE:View.GONE);
        view.setViewVisibility(R.id.widget_empty_text,focus!=null&&picture==null?View.VISIBLE:View.GONE);
        view.setImageViewBitmap(R.id.widget_photo,picture==null?null:WidgetArtwork.photograph(picture,images.get(index),width,height,24*renderScale));
        view.setImageViewBitmap(R.id.widget_country_map,focus==null?null:WidgetArtwork.country(focus,144,144,true));
        float emptyLabelDp=32*fontScale+8;
        view.setViewPadding(R.id.widget_empty_map,0,0,0,Math.round(emptyLabelDp*density));
        view.setImageViewBitmap(R.id.widget_empty_map,focus==null||picture!=null?null:WidgetArtwork.country(focus,width,Math.max(1,height-Math.round(emptyLabelDp*renderScale)),lightInk));
        view.setTextViewText(R.id.widget_empty_text,images.isEmpty()?"No photos yet":"Open Worldwide to save photos");
        view.setContentDescription(R.id.widget_country_map,focus==null?"":focus.name+" fitted to view");
        view.setContentDescription(R.id.widget_country_inset,focus==null?"":focus.name+" map");
        if(Build.VERSION.SDK_INT>=31){view.setViewLayoutWidth(R.id.widget_country_inset,compact?48:72,TypedValue.COMPLEX_UNIT_DIP);view.setViewLayoutHeight(R.id.widget_country_inset,compact?48:72,TypedValue.COMPLEX_UNIT_DIP);}
        view.removeAllViews(R.id.widget_grid);
        for(int row=0;row<ROWS;row++){
            RemoteViews line=new RemoteViews(c.getPackageName(),R.layout.map_widget_row);
            for(int col=0;col<COLS;col++){
                RemoteViews cell=new RemoteViews(c.getPackageName(),R.layout.map_widget_cell);int target=hit(map.regions,width,height,col,row);
                if(target>=0){Country country=all.get(target);cell.setContentDescription(R.id.widget_cell,country.name);cell.setOnClickPendingIntent(R.id.widget_cell,tap(c,id,country.id));}
                line.addView(R.id.widget_row,cell);
            }
            view.addView(R.id.widget_grid,line);
        }
        view.setDisplayedChild(R.id.widget_stage,focus==null?0:1);
        return view;
    }
    private static String quantity(int number,String singular){return quantity(number,singular,singular+"s");}
    private static String quantity(int number,String singular,String plural){return number+" "+(number==1?singular:plural);}
    static int hit(List<Region> regions,int width,int height,int col,int row){
        // The center is the primary target. Subsamples keep narrow coastlines tappable.
        float[][] samples={{.5f,.5f},{.25f,.25f},{.75f,.25f},{.25f,.75f},{.75f,.75f}};
        for(float[] sample:samples){int x=(int)((col+sample[0])*width/COLS),y=(int)((row+sample[1])*height/ROWS);for(int i=regions.size()-1;i>=0;i--)if(regions.get(i).contains(x,y))return i;}
        return -1;
    }
}
