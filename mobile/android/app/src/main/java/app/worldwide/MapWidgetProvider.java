package app.worldwide;

import android.app.PendingIntent;
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
        return result;
    }
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
        super.onReceive(c,intent);
        if(!ACTION.equals(intent.getAction()))return;
        int id=intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,-1);
        if(!contains(AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,MapWidgetProvider.class)),id))return;
        select(c,id,intent.getStringExtra("tap"));update(c,id);
    }
    private static boolean contains(int[] values,int value){for(int n:values)if(n==value)return true;return false;}
    static void select(Context c,int id,String action){try{
        if(action==null)return;SharedPreferences prefs=state(c);String selected=prefs.getString(key(id),"");
        if(action.equals("photo")){prefs.edit().putInt("photo-"+id,(prefs.getInt("photo-"+id,0)+1)%Math.max(1,photos(album(c),selected).size())).apply();return;}
        if(action.equals("world"))selected="";
        else if(action.equals("next")){
            List<Country> all=countries(c),choices=new ArrayList<>();JSONObject data=album(c);
            for(Country country:all)if(!photos(data,country.id).isEmpty())choices.add(country);
            if(choices.isEmpty())choices=all;
            int at=-1;for(int i=0;i<choices.size();i++)if(choices.get(i).id.equals(selected))at=i;
            selected=choices.get((at+1)%choices.size()).id;
        }else {boolean valid=false;for(Country country:countries(c))if(country.id.equals(action)){valid=true;break;}if(!valid)return;selected=action;}
        prefs.edit().putString(key(id),selected).putInt("photo-"+id,0).apply();
    }catch(Exception ignored){}}
    @Override public void onUpdate(Context c,AppWidgetManager manager,int[] ids){for(int id:ids)update(c,id);}
    @Override public void onAppWidgetOptionsChanged(Context c,AppWidgetManager manager,int id,Bundle options){update(c,id);}
    @Override public void onDeleted(Context c,int[] ids){SharedPreferences.Editor edit=state(c).edit();for(int id:ids)edit.remove(key(id)).remove("photo-"+id);edit.apply();}
    static synchronized void refresh(Context c){for(int id:AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,MapWidgetProvider.class)))update(c,id);}
    static synchronized void clear(Context c){state(c).edit().clear().commit();refresh(c);}
    static synchronized void update(Context c,int id){
        try{AppWidgetManager.getInstance(c).updateAppWidget(id,render(c,id));}
        catch(Exception e){android.util.Log.e("WorldwideWidget","Could not draw map",e);RemoteViews fallback=new RemoteViews(c.getPackageName(),R.layout.map_widget);fallback.setTextViewText(R.id.widget_hint,"Open Worldwide to refresh your map");AppWidgetManager.getInstance(c).updateAppWidget(id,fallback);}
    }
    static synchronized RemoteViews render(Context c,int id)throws Exception {
        List<Country> all=countries(c);JSONObject data=album(c);String selected=state(c).getString(key(id),"");Country focus=null;
        for(Country country:all)if(country.id.equals(selected))focus=country;
        List<JSONObject> images=photos(data,selected);
        int index=Math.floorMod(state(c).getInt("photo-"+id,0),Math.max(1,images.size()));Bitmap picture=images.isEmpty()?null:photo(c,images.get(index));
        Bundle options=AppWidgetManager.getInstance(c).getAppWidgetOptions(id);
        int dpWidth=Math.max(180,options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,300));
        int dpHeight=Math.max(180,options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,260));
        int width=600,height=Math.min(600,Math.max(120,Math.round(600f*(dpHeight-68-(picture==null?0:96))/(dpWidth-8))));
        RectF bounds=focus==null?new RectF(0,0,1200,580):new RectF(focus.bounds);
        float scale=Math.min(width/(bounds.width()+Math.max(2,bounds.width()*.14f)),height/(bounds.height()+Math.max(2,bounds.height()*.14f)));
        Matrix matrix=new Matrix();matrix.setScale(scale,scale);matrix.postTranslate(width/2f-bounds.centerX()*scale,height/2f-bounds.centerY()*scale);
        Bitmap map=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(map);Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
        Region clip=new Region(0,0,width,height);List<Region> regions=new ArrayList<>();
        Set<String> saved=new HashSet<>();JSONArray list=data.optJSONArray("photos");if(list!=null)for(int i=0;i<list.length();i++)saved.add(list.getJSONObject(i).optString("countryId"));
        for(Country country:all){
            Path path=new Path();country.path.transform(matrix,path);Region region=new Region();region.setPath(path,clip);regions.add(region);
            paint.setStyle(Paint.Style.FILL);paint.setColor(country==focus?0xff72c49b:saved.contains(country.id)?0xff699d80:0xdde5ede7);canvas.drawPath(path,paint);
            paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(1);paint.setColor(0xff335d48);canvas.drawPath(path,paint);
        }
        RemoteViews view=new RemoteViews(c.getPackageName(),R.layout.map_widget);
        view.setTextViewText(R.id.widget_title,focus==null?"Worldwide":focus.name);view.setImageViewBitmap(R.id.widget_map,map);
        view.setOnClickPendingIntent(R.id.widget_back,tap(c,id,"world"));view.setOnClickPendingIntent(R.id.widget_next,tap(c,id,"next"));
        view.setOnClickPendingIntent(R.id.widget_photo,tap(c,id,"photo"));
        view.setViewVisibility(R.id.widget_photo,picture==null?View.GONE:View.VISIBLE);view.setImageViewBitmap(R.id.widget_photo,picture);
        view.setTextViewText(R.id.widget_hint,focus==null?"Tap a country · Next browses saved places":picture!=null?(index+1)+" / "+images.size()+" · Tap photo for next":images.isEmpty()?"No saved photos for this country":"Open Worldwide to save this photo offline");
        view.removeAllViews(R.id.widget_grid);
        for(int row=0;row<ROWS;row++){
            RemoteViews line=new RemoteViews(c.getPackageName(),R.layout.map_widget_row);
            // Give the row a stable root ID so children can be appended by RemoteViews.
            for(int col=0;col<COLS;col++){
                RemoteViews cell=new RemoteViews(c.getPackageName(),R.layout.map_widget_cell);
                int hit=hit(regions,width,height,col,row);
                if(hit>=0){Country country=all.get(hit);cell.setContentDescription(R.id.widget_cell,country.name);cell.setOnClickPendingIntent(R.id.widget_cell,tap(c,id,country.id));}
                line.addView(R.id.widget_row,cell);
            }
            view.addView(R.id.widget_grid,line);
        }
        return view;
    }
    static int hit(List<Region> regions,int width,int height,int col,int row){
        // The center is the primary target. Subsamples keep narrow coastlines tappable.
        float[][] samples={{.5f,.5f},{.25f,.25f},{.75f,.25f},{.25f,.75f},{.75f,.75f}};
        for(float[] sample:samples){int x=(int)((col+sample[0])*width/COLS),y=(int)((row+sample[1])*height/ROWS);for(int i=regions.size()-1;i>=0;i--)if(regions.get(i).contains(x,y))return i;}
        return -1;
    }
}
