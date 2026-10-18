package app.worldwide;

import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PathMeasure;
import android.graphics.PointF;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Region;
import android.graphics.RegionIterator;
import android.graphics.Shader;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;

/** Small, transparent artwork for RemoteViews. Source paths remain untouched. */
final class WidgetArtwork {
    private static final int MAX_SIZE = 640;
    private static final RectF WORLD = new RectF(0, 0, 1200, 580);
    private static final Map<MapWidgetProvider.Country, PointF> MARKERS =
            Collections.synchronizedMap(new WeakHashMap<>());
    private static final Map<MapWidgetProvider.Country, CountryDrawing> COUNTRY_DRAWINGS =
            Collections.synchronizedMap(new WeakHashMap<>());

    private static final class CountryDrawing {
        final Path path;
        final RectF bounds;

        CountryDrawing(Path path, RectF bounds) {
            this.path = path;
            this.bounds = bounds;
        }
    }

    static final class MapImage {
        final Bitmap bitmap;
        // Indexes correspond exactly to the supplied country list.
        final List<Region> regions;

        MapImage(Bitmap bitmap, List<Region> regions) {
            this.bitmap = bitmap;
            this.regions = regions;
        }
    }

    private WidgetArtwork() {}

    static MapImage world(List<MapWidgetProvider.Country> all, Set<String> saved,
            Set<String> visited, int width, int height, boolean lightInk) {
        width = size(width);
        height = size(height);
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Matrix matrix = fit(WORLD, width, height, 8);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        Region clip = new Region(0, 0, width, height);
        List<Region> regions = new ArrayList<>(all.size());
        float stroke = Math.max(.55f, Math.min(width, height) / 520f);

        for (MapWidgetProvider.Country country : all) {
            Path path = new Path();
            country.path.transform(matrix, path);
            Region region = new Region();
            region.setPath(path, clip);
            regions.add(region);
            boolean hasPhotos = saved != null && saved.contains(country.id);
            boolean hasVisited = visited != null && visited.contains(country.id);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(hasPhotos ? (lightInk ? 0xff4f8b6a : 0xff497e60)
                    : hasVisited ? (lightInk ? 0xffa7bcac : 0xff9db5a4)
                    : (lightInk ? 0xe8e5ecea : 0xe8dce5e2));
            canvas.drawPath(path, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeJoin(Paint.Join.ROUND);
            paint.setStrokeWidth(stroke);
            paint.setColor(lightInk ? 0x88798e85 : 0x9965786f);
            canvas.drawPath(path, paint);
        }

        // A quiet pin on the land itself, never in a country's bounding-box ocean.
        paint.setStyle(Paint.Style.FILL);
        if (saved != null) for (MapWidgetProvider.Country country : all) {
            if (!saved.contains(country.id)) continue;
            PointF anchor = marker(country);
            if (anchor == null) continue;
            float[] position = {anchor.x, anchor.y};
            matrix.mapPoints(position);
            float radius = Math.max(2f, Math.min(3f, width / 200f));
            paint.setColor(0x55405849);
            canvas.drawCircle(position[0], position[1] + .4f, radius + .8f, paint);
            paint.setColor(0xfff5faf6);
            canvas.drawCircle(position[0], position[1], radius, paint);
            paint.setColor(0xff446d55);
            canvas.drawCircle(position[0], position[1], radius * .43f, paint);
        }
        return new MapImage(bitmap, regions);
    }

    /**
     * Fit the original country silhouette. For extremely scattered territories,
     * fit the main mainland/island group so the inset stays legible;
     * the world map continues to show every island in its geographic position.
     */
    static Bitmap country(MapWidgetProvider.Country country, int width, int height,
            boolean lightInk) {
        width = size(width);
        height = size(height);
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        if (country == null) return bitmap;
        Canvas canvas = new Canvas(bitmap);
        float padding = Math.max(7, Math.min(width, height) * .09f);
        CountryDrawing drawing = countryDrawing(country);
        Path path = new Path();
        drawing.path.transform(fit(drawing.bounds, width, height, padding), path);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(lightInk ? 0xff9db9a5 : 0xff7d9f87);
        paint.setShadowLayer(2.5f, 0, 1.5f, 0x19304537);
        canvas.drawPath(path, paint);
        paint.clearShadowLayer();
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeJoin(Paint.Join.ROUND);
        paint.setStrokeWidth(.85f);
        paint.setColor(lightInk ? 0xcce8f1e9 : 0xbbe0ede2);
        canvas.drawPath(path, paint);
        return bitmap;
    }

    private static CountryDrawing countryDrawing(MapWidgetProvider.Country country) {
        CountryDrawing cached = COUNTRY_DRAWINGS.get(country);
        if (cached != null) return cached;
        PathMeasure measure = new PathMeasure(country.path, true);
        Path largest = null;
        RectF largestBounds = null;
        float largestArea = 0;
        List<RectF> contours = new ArrayList<>();
        do {
            float length = measure.getLength();
            if (length <= 0) continue;
            Path contour = new Path();
            if (!measure.getSegment(0, length, contour, true)) continue;
            contour.close();
            RectF bounds = new RectF();
            contour.computeBounds(bounds, true);
            contours.add(bounds);
            float area = bounds.width() * bounds.height();
            // A hole's contour is smaller than its enclosing mainland contour.
            if (area > largestArea) {
                largestArea = area;
                largest = contour;
                largestBounds = bounds;
            }
        } while (measure.nextContour());
        float fullArea = country.bounds.width() * country.bounds.height();
        RectF focus = country.bounds;
        if(largest != null && largestArea < fullArea * .12f){
            RectF neighbourhood=new RectF(largestBounds);neighbourhood.inset(-largestBounds.width()*.5f,-largestBounds.height()*.5f);
            focus=new RectF(largestBounds);
            for(RectF contour:contours)if(neighbourhood.contains(contour.centerX(),contour.centerY()))focus.union(contour);
        }
        // Keep the original compound path, including lakes and nearby islands.
        CountryDrawing drawing = new CountryDrawing(country.path, focus);
        COUNTRY_DRAWINGS.put(country, drawing);
        return drawing;
    }

    /** Match photoPlacement: positive crop coordinates move the image right/down. */
    static Bitmap photograph(Bitmap source, JSONObject photo, int width, int height,
            float radius) {
        width = size(width);
        height = size(height);
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        if (source == null || source.isRecycled()) return bitmap;
        float zoom = number(photo, "cropZoom", 1, 1, 5);
        float cropX = number(photo, "cropX", 0, -1, 1);
        float cropY = number(photo, "cropY", 0, -1, 1);
        float scale = Math.max((float) width / source.getWidth(),
                (float) height / source.getHeight()) * zoom;
        float overflowX = (source.getWidth() * scale - width) / 2;
        float overflowY = (source.getHeight() * scale - height) / 2;
        Matrix matrix = new Matrix();
        matrix.setScale(scale, scale);
        matrix.postTranslate(-overflowX + cropX * overflowX,
                -overflowY + cropY * overflowY);
        BitmapShader shader = new BitmapShader(source, Shader.TileMode.CLAMP,
                Shader.TileMode.CLAMP);
        shader.setLocalMatrix(matrix);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        paint.setShader(shader);
        float corner = Float.isNaN(radius) ? 0 : Math.max(0,
                Math.min(radius, Math.min(width, height) / 2f));
        new Canvas(bitmap).drawRoundRect(new RectF(0, 0, width, height),
                corner, corner, paint);
        return bitmap;
    }

    private static int size(int value) { return Math.max(1, Math.min(MAX_SIZE, value)); }

    private static float number(JSONObject object, String key, float fallback,
            float minimum, float maximum) {
        double value = object == null ? fallback : object.optDouble(key, fallback);
        return Double.isNaN(value) || Double.isInfinite(value) ? fallback
                : (float) Math.max(minimum, Math.min(maximum, value));
    }

    private static Matrix fit(RectF bounds, int width, int height, float padding) {
        float inset = Math.min(padding, Math.max(0, (Math.min(width, height) - 1) / 2f));
        float scale = Math.min((width - inset * 2) / Math.max(.01f, bounds.width()),
                (height - inset * 2) / Math.max(.01f, bounds.height()));
        Matrix matrix = new Matrix();
        matrix.setScale(scale, scale);
        matrix.postTranslate(width / 2f - bounds.centerX() * scale,
                height / 2f - bounds.centerY() * scale);
        return matrix;
    }

    private static PointF marker(MapWidgetProvider.Country country) {
        PointF cached = MARKERS.get(country);
        if (cached != null) return cached;
        // Use four source samples per map unit so small island nations retain an
        // interior. The largest rectangular land span favors mainland
        // over distant islands; its midpoint is guaranteed to lie within land.
        Matrix sample = new Matrix();
        sample.setScale(4, 4);
        Path path = new Path();
        country.path.transform(sample, path);
        Region region = new Region();
        region.setPath(path, new Region(0, 0, 4800, 2320));
        RegionIterator iterator = new RegionIterator(region);
        Rect rect = new Rect();
        Rect best = new Rect();
        float bestScore = -1;
        while (iterator.next(rect)) {
            float score = rect.width() * (float) Math.max(1, rect.height());
            if (score > bestScore) {
                bestScore = score;
                best.set(rect);
            }
        }
        if (bestScore < 0) return null;
        PointF anchor = new PointF(best.exactCenterX() / 4f, best.exactCenterY() / 4f);
        MARKERS.put(country, anchor);
        return anchor;
    }
}
