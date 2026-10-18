package app.worldwide;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Device-owned album. Metadata and its replay journal commit in one SQLite transaction. */
final class LocalAlbum {
    static final class Reply {
        final int status; final String mime; final byte[] bytes;
        Reply(int status,String mime,byte[] bytes){this.status=status;this.mime=mime;this.bytes=bytes;}
    }
    static final class ApiException extends IOException {
        final int status; ApiException(int status,String message){super(message);this.status=status;}
    }
    static final class Mutation {
        final long id; final String path,method; final JSONObject body;
        Mutation(long id,String path,String method,JSONObject body){this.id=id;this.path=path;this.method=method;this.body=body;}
    }
    static final class Upload {
        final String contentType; final byte[] bytes;
        Upload(String contentType,byte[] bytes){this.contentType=contentType;this.bytes=bytes;}
    }
    private final File directory;
    private final SQLiteDatabase db;
    private final Set<String> countryIds;
    LocalAlbum(File directory,boolean migratedFromLinkedAccount,Set<String> countryIds)throws Exception{
        this.countryIds=new HashSet<>(countryIds);
        this.directory=directory;directory.mkdirs();
        db=SQLiteDatabase.openOrCreateDatabase(new File(directory,"local.sqlite"),null);
        db.execSQL("PRAGMA synchronous=FULL");
        db.execSQL("CREATE TABLE IF NOT EXISTS album (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, revision INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE IF NOT EXISTS mutations (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, method TEXT NOT NULL, body TEXT NOT NULL)");
        try(Cursor row=db.rawQuery("SELECT id FROM album WHERE id=1",null)){
            if(!row.moveToFirst()){
                File legacy=new File(directory,"atlas.json");
                JSONObject atlas=legacy.isFile()?new JSONObject(new String(Files.readAllBytes(legacy.toPath()),StandardCharsets.UTF_8)):empty();
                atlas.getJSONArray("photos");atlas.getJSONArray("visits");
                db.beginTransaction();try{
                    ContentValues values=new ContentValues();values.put("id",1);values.put("json",atlas.toString());values.put("revision",0);db.insertOrThrow("album",null,values);
                    if(!migratedFromLinkedAccount){
                        JSONArray photos=atlas.getJSONArray("photos");for(int i=0;i<photos.length();i++){
                            JSONObject photo=photos.getJSONObject(i);enqueue("/api/photos","POST",photo);
                            JSONObject crop=new JSONObject().put("cropX",photo.optDouble("cropX",0)).put("cropY",photo.optDouble("cropY",0)).put("cropZoom",photo.optDouble("cropZoom",1));
                            enqueue("/api/photos/"+photo.getString("id"),"PATCH",crop);
                        }
                        JSONArray visits=atlas.getJSONArray("visits");for(int i=0;i<visits.length();i++){JSONObject visit=visits.getJSONObject(i);enqueue("/api/countries/"+visit.getString("countryId"),"PATCH",visitPatch(visit));}
                    }
                    db.setTransactionSuccessful();
                }finally{db.endTransaction();}
            }
        }
        mirror();
    }
    private static JSONObject empty()throws Exception{return new JSONObject().put("photos",new JSONArray()).put("visits",new JSONArray()).put("mapStyle","natural-earth");}
    synchronized JSONObject atlas()throws Exception{try(Cursor row=db.rawQuery("SELECT json FROM album WHERE id=1",null)){if(!row.moveToFirst())throw new IOException("The local album could not be opened.");return new JSONObject(row.getString(0));}}
    synchronized long revision(){try(Cursor row=db.rawQuery("SELECT revision FROM album WHERE id=1",null)){row.moveToFirst();return row.getLong(0);}}
    synchronized int pending(){try(Cursor row=db.rawQuery("SELECT COUNT(*) FROM mutations",null)){row.moveToFirst();return row.getInt(0);}}
    synchronized Mutation next()throws Exception{try(Cursor row=db.rawQuery("SELECT id,path,method,body FROM mutations ORDER BY id LIMIT 1",null)){return row.moveToFirst()?new Mutation(row.getLong(0),row.getString(1),row.getString(2),new JSONObject(row.getString(3))):null;}}
    synchronized void acknowledge(long id){db.delete("mutations","id=?",new String[]{Long.toString(id)});}
    private void enqueue(String path,String method,JSONObject body){ContentValues values=new ContentValues();values.put("path",path);values.put("method",method);values.put("body",body.toString());db.insertOrThrow("mutations",null,values);}
    private void write(JSONObject atlas){ContentValues values=new ContentValues();values.put("json",atlas.toString());db.update("album",values,"id=1",null);db.execSQL("UPDATE album SET revision=revision+1 WHERE id=1");}
    private void mirror()throws Exception{atomic(new File(directory,"atlas.json"),atlas().toString().getBytes(StandardCharsets.UTF_8));}
    private void mirrorBestEffort(){try{mirror();}catch(Exception ignored){/* SQLite remains authoritative; retry on the next change/start. */}}
    static String key(String path)throws Exception{byte[] hash=MessageDigest.getInstance("SHA-256").digest(path.getBytes(StandardCharsets.UTF_8));StringBuilder value=new StringBuilder();for(byte b:hash)value.append(String.format(Locale.ROOT,"%02x",b));return value.toString();}
    private static void atomic(File destination,byte[] bytes)throws Exception{
        File temporary=File.createTempFile("local-",".tmp",destination.getParentFile());
        try{try(FileOutputStream stream=new FileOutputStream(temporary)){stream.write(bytes);stream.getFD().sync();}
            Files.move(temporary.toPath(),destination.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
            java.io.FileDescriptor folder=android.system.Os.open(destination.getParent(),android.system.OsConstants.O_RDONLY,0);
            try{android.system.Os.fsync(folder);}finally{android.system.Os.close(folder);}
        }finally{temporary.delete();}
    }
    synchronized Reply photo(String id)throws Exception{
        String key=key("/api/photos/"+id);File bytes=new File(directory,key+".photo"),mime=new File(directory,key+".mime");
        if(!bytes.isFile()||!mime.isFile())return null;
        String type=new String(Files.readAllBytes(mime.toPath()),StandardCharsets.UTF_8);if(!type.startsWith("image/"))return null;
        return new Reply(200,type,Files.readAllBytes(bytes.toPath()));
    }
    synchronized boolean hasPhoto(String id)throws Exception{return new File(directory,key("/api/photos/"+id)+".photo").isFile()&&new File(directory,key("/api/photos/"+id)+".mime").isFile();}
    synchronized void savePhoto(String id,String mime,byte[] bytes)throws Exception{
        if(!id.matches("[a-zA-Z0-9_-]+")||!mime.startsWith("image/"))throw new IOException("Invalid photo response.");
        String key=key("/api/photos/"+id);atomic(new File(directory,key+".photo"),bytes);atomic(new File(directory,key+".mime"),mime.getBytes(StandardCharsets.UTF_8));
    }
    private static Reply json(int status,JSONObject value){return new Reply(status,"application/json",value.toString().getBytes(StandardCharsets.UTF_8));}
    private static JSONObject ok()throws Exception{return new JSONObject().put("ok",true);}
    private static void require(boolean condition,String message)throws ApiException{if(!condition)throw new ApiException(400,message);}
    private static int find(JSONArray list,String key,String value)throws Exception{for(int i=0;i<list.length();i++)if(value.equals(list.getJSONObject(i).optString(key)))return i;return -1;}
    private String country(String value)throws ApiException{require(countryIds.contains(value),"Choose a country.");return value;}
    private static JSONObject visit(JSONArray visits,String country)throws Exception{
        int index=find(visits,"countryId",country);if(index>=0)return visits.getJSONObject(index);
        JSONObject value=new JSONObject().put("countryId",country).put("visited",0).put("coverId",JSONObject.NULL).put("note","").put("visitDate",JSONObject.NULL).put("updatedAt",Instant.now().toString());visits.put(value);return value;
    }
    private static JSONObject visitPatch(JSONObject visit)throws Exception{return new JSONObject().put("visited",visit.optInt("visited")==1||visit.optBoolean("visited")).put("coverId",visit.opt("coverId")).put("note",visit.optString("note")).put("visitDate",visit.opt("visitDate"));}
    /** Return null for account/network routes; all album mutations are synchronous local commits. */
    synchronized Reply request(String path,String method,JSONObject headers,byte[] bytes)throws Exception{
        if(path.equals("/api/atlas")&&method.equals("GET"))return json(200,atlas());
        if(path.matches("/api/photos/[a-zA-Z0-9_-]+")&&method.equals("GET")){
            String id=path.substring("/api/photos/".length());if(find(atlas().getJSONArray("photos"),"id",id)<0)throw new ApiException(404,"Photo not found.");
            Reply saved=photo(id);if(saved==null)throw new ApiException(404,"This photo has not downloaded yet. Connect once to save it on this device.");return saved;
        }
        boolean upload=path.equals("/api/photos")&&method.equals("POST");
        boolean order=path.equals("/api/photos/order")&&method.equals("PATCH");
        boolean photo=path.matches("/api/photos/[a-zA-Z0-9_-]+")&&(method.equals("PATCH")||method.equals("DELETE"))&&!order;
        boolean country=path.matches("/api/countries/[A-Z]{3}")&&method.equals("PATCH");
        boolean preference=path.equals("/api/preferences")&&method.equals("PATCH");
        if(!upload&&!order&&!photo&&!country&&!preference)return null;
        JSONObject body=upload?new JSONObject():bytes.length==0?new JSONObject():new JSONObject(new String(bytes,StandardCharsets.UTF_8));
        JSONObject atlas=atlas();JSONArray photos=atlas.getJSONArray("photos"),visits=atlas.getJSONArray("visits");JSONObject response=ok();int status=200;
        if(upload){
            Map<String,Part> parts=multipart(headers==null?"":headers.optString("content-type"),bytes);Part file=parts.get("photo");
            String countryId=country(field(parts,"countryId"));require(file!=null&&file.bytes.length>0&&file.bytes.length<=8*1024*1024,"Choose a photo smaller than 8 MB.");
            require(validImage(file.mime,file.bytes),"Use a valid JPG, PNG, WebP, GIF or AVIF photo.");
            String id=UUID.randomUUID().toString(),caption=field(parts,"caption");if(caption.length()>500)caption=caption.substring(0,500);
            int width=dimension(field(parts,"width")),height=dimension(field(parts,"height"));require((width==0)==(height==0),"Invalid photo dimensions.");
            body=new JSONObject().put("id",id).put("photoId",id).put("countryId",countryId).put("caption",caption).put("width",width).put("height",height).put("createdAt",Instant.now().toString()).put("cropX",0).put("cropY",0).put("cropZoom",1);
            // Bytes are durable before the transaction can expose a photo or queue an upload.
            savePhoto(id,file.mime,file.bytes);JSONArray ordered=new JSONArray().put(body);for(int i=0;i<photos.length();i++)ordered.put(photos.get(i));atlas.put("photos",ordered);
            JSONObject visit=visit(visits,countryId);visit.put("visited",1).put("updatedAt",Instant.now().toString());if(visit.isNull("coverId"))visit.put("coverId",id);response=body;status=201;
        }else if(order){
            String countryId=country(body.optString("countryId"));JSONArray ids=body.optJSONArray("ids");require(ids!=null,"Invalid photo order.");Set<String> expected=new HashSet<>(),supplied=new HashSet<>();
            for(int i=0;i<photos.length();i++)if(countryId.equals(photos.getJSONObject(i).getString("countryId")))expected.add(photos.getJSONObject(i).getString("id"));
            JSONArray ordered=new JSONArray();for(int i=0;i<ids.length();i++){String id=ids.getString(i);require(supplied.add(id)&&expected.contains(id),"Invalid photo order.");ordered.put(photos.getJSONObject(find(photos,"id",id)));}
            require(expected.equals(supplied),"Photos changed. Please try again.");for(int i=0;i<photos.length();i++)if(!countryId.equals(photos.getJSONObject(i).getString("countryId")))ordered.put(photos.get(i));atlas.put("photos",ordered);
        }else if(photo){
            String id=path.substring("/api/photos/".length());int index=find(photos,"id",id);if(index<0)throw new ApiException(404,"Photo not found.");JSONObject value=photos.getJSONObject(index);
            if(method.equals("DELETE")){
                photos.remove(index);for(int i=0;i<visits.length();i++){JSONObject visit=visits.getJSONObject(i);if(id.equals(visit.optString("coverId"))){visit.put("coverId",JSONObject.NULL);for(int j=0;j<photos.length();j++)if(value.getString("countryId").equals(photos.getJSONObject(j).getString("countryId"))){visit.put("coverId",photos.getJSONObject(j).getString("id"));break;}}}
                // Keep bytes for older queued uploads until their replay finishes; never prune pending data.
            }else{
                boolean changed=false;for(String name:new String[]{"caption","cropX","cropY","cropZoom"})if(body.has(name)){
                    Object raw=body.get(name);if(name.equals("caption"))require(raw instanceof String&&((String)raw).length()<=500,"Keep captions under 500 characters.");
                    else require(raw instanceof Number&&Double.isFinite(((Number)raw).doubleValue())&&((Number)raw).doubleValue()>=(name.equals("cropZoom")?1:-1)&&((Number)raw).doubleValue()<=(name.equals("cropZoom")?5:1),"Invalid photo position.");
                    value.put(name,raw);changed=true;
                }require(changed,"No photo changes supplied.");
            }
        }else if(country){
            String id=country(path.substring("/api/countries/".length()));JSONObject visit=visit(visits,id);
            if(body.has("visited")){require(body.get("visited") instanceof Boolean,"Invalid visit status.");visit.put("visited",body.getBoolean("visited")?1:0);}
            if(body.has("note")){require(body.get("note") instanceof String&&body.getString("note").length()<=4000,"Keep notes under 4,000 characters.");visit.put("note",body.get("note"));}
            if(body.has("visitDate")){if(!body.isNull("visitDate")){require(body.get("visitDate") instanceof String&&body.getString("visitDate").matches("\\d{4}-\\d{2}-\\d{2}"),"Choose a valid date.");try{LocalDate.parse(body.getString("visitDate"));}catch(Exception invalid){throw new ApiException(400,"Choose a valid date.");}}visit.put("visitDate",body.get("visitDate"));}
            if(body.has("coverId")){if(!body.isNull("coverId")){int index=find(photos,"id",body.getString("coverId"));require(index>=0&&id.equals(photos.getJSONObject(index).getString("countryId")),"Choose a photo from this country.");}visit.put("coverId",body.get("coverId"));}
            visit.put("updatedAt",Instant.now().toString());
        }else{
            String style=body.optString("mapStyle");require(Arrays.asList("equal-earth","natural-earth","robinson","winkel-tripel","mercator","equirectangular","mollweide","gall-peters","sinusoidal","eckert-iv","goode").contains(style),"Choose a valid map style.");atlas.put("mapStyle",style);
        }
        db.beginTransaction();try{write(atlas);enqueue(path,method,body);db.setTransactionSuccessful();}finally{db.endTransaction();}mirrorBestEffort();if(method.equals("DELETE"))try{prune();}catch(Exception ignored){}return json(status,response);
    }
    synchronized boolean containsPhoto(String id)throws Exception{return find(atlas().getJSONArray("photos"),"id",id)>=0;}
    synchronized void prune()throws Exception{
        Set<String> keep=new HashSet<>();JSONArray photos=atlas().getJSONArray("photos");
        for(int i=0;i<photos.length();i++)keep.add(key("/api/photos/"+photos.getJSONObject(i).getString("id")));
        try(Cursor rows=db.rawQuery("SELECT body FROM mutations WHERE path='/api/photos' AND method='POST'",null)){while(rows.moveToNext())keep.add(key("/api/photos/"+new JSONObject(rows.getString(0)).getString("id")));}
        File[] files=directory.listFiles();if(files!=null)for(File file:files)if(file.getName().matches("[a-f0-9]{64}\\.(photo|mime)")&&!keep.contains(file.getName().substring(0,64)))file.delete();
    }
    synchronized void close(){db.close();}
    synchronized boolean acceptRemote(JSONObject remote,long expectedRevision)throws Exception{
        if(revision()!=expectedRevision||pending()!=0)return false;
        remote.getJSONArray("photos");remote.getJSONArray("visits");
        if(remote.toString().equals(atlas().toString()))return true;
        db.beginTransaction();try{write(remote);db.setTransactionSuccessful();}finally{db.endTransaction();}mirrorBestEffort();return true;
    }
    synchronized Upload upload(Mutation mutation)throws Exception{
        JSONObject photo=mutation.body;Reply bytes=photo(photo.getString("id"));if(bytes==null)throw new IOException("A pending photo is missing from this device. Your other changes are still saved.");
        String boundary="Worldwide"+UUID.randomUUID().toString().replace("-","");ByteArrayOutputStream stream=new ByteArrayOutputStream();
        for(String field:new String[]{"countryId","caption","width","height"})writePart(stream,boundary,field,photo.optString(field),null,null);
        writePart(stream,boundary,"photoId",photo.getString("id"),null,null);
        writePart(stream,boundary,"photo",null,bytes.mime,bytes.bytes);stream.write(("--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8));return new Upload("multipart/form-data; boundary="+boundary,stream.toByteArray());
    }
    private static void writePart(ByteArrayOutputStream stream,String boundary,String name,String value,String mime,byte[] bytes)throws IOException{
        stream.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\""+(bytes==null?"":"; filename=\"photo\"")+"\r\n"+(bytes==null?"":"Content-Type: "+mime+"\r\n")+"\r\n").getBytes(StandardCharsets.UTF_8));stream.write(bytes==null?value.getBytes(StandardCharsets.UTF_8):bytes);stream.write("\r\n".getBytes(StandardCharsets.UTF_8));
    }
    private static final class Part {final byte[] bytes;final String mime;Part(byte[] bytes,String mime){this.bytes=bytes;this.mime=mime;}}
    private static String field(Map<String,Part> parts,String name){Part value=parts.get(name);return value==null?"":new String(value.bytes,StandardCharsets.UTF_8);}
    private static int dimension(String value)throws ApiException{try{int n=value.isEmpty()?0:Integer.parseInt(value);require(n>=0&&n<=16384,"Invalid photo dimensions.");return n;}catch(NumberFormatException error){throw new ApiException(400,"Invalid photo dimensions.");}}
    private static Map<String,Part> multipart(String type,byte[] bytes)throws Exception{
        Matcher matcher=Pattern.compile("boundary=(?:\"([^\"]+)\"|([^;\\s]+))").matcher(type);require(type.startsWith("multipart/form-data")&&matcher.find(),"Choose a photo to upload.");String boundary=matcher.group(1)==null?matcher.group(2):matcher.group(1);require(boundary.length()<=200,"Invalid upload.");
        String data=new String(bytes,StandardCharsets.ISO_8859_1),marker="--"+boundary;Map<String,Part> result=new HashMap<>();int offset=0;
        while(data.startsWith(marker,offset)){offset+=marker.length();if(data.startsWith("--",offset))break;require(data.startsWith("\r\n",offset),"Invalid upload.");offset+=2;int end=data.indexOf("\r\n\r\n",offset);require(end>=offset&&end-offset<8192,"Invalid upload.");String header=data.substring(offset,end);int next=data.indexOf("\r\n"+marker,end+4);require(next>=0,"Invalid upload.");
            Matcher name=Pattern.compile("(?:^|;)\\s*name=\"([^\"]+)\"",Pattern.MULTILINE).matcher(header.substring(header.indexOf(':')+1));require(name.find(),"Invalid upload field.");String mime="";Matcher content=Pattern.compile("(?im)^Content-Type:\\s*([^\\r\\n;]+)").matcher(header);if(content.find())mime=content.group(1).trim();result.put(name.group(1),new Part(Arrays.copyOfRange(bytes,end+4,next),mime));offset=next+2;
        }require(!result.isEmpty(),"Invalid upload.");return result;
    }
    private static boolean validImage(String type,byte[] bytes){
        if(bytes.length<12)return false;String prefix=new String(bytes,0,Math.min(bytes.length,32),StandardCharsets.ISO_8859_1);
        return type.equals("image/jpeg")&&(bytes[0]&255)==255&&(bytes[1]&255)==216||type.equals("image/png")&&(bytes[0]&255)==137&&bytes[1]==80||type.equals("image/webp")&&prefix.startsWith("RIFF")&&prefix.substring(8).startsWith("WEBP")||type.equals("image/gif")&&prefix.startsWith("GIF")||type.equals("image/avif")&&prefix.substring(4).startsWith("ftyp")&&(prefix.contains("avif")||prefix.contains("avis"));
    }
}
