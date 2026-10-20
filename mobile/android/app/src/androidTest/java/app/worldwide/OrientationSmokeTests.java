package app.worldwide;

import android.app.Instrumentation;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** Standalone instrumentation runner, configured only for a disposable package. */
public final class OrientationSmokeTests extends Instrumentation {
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){
        Bundle report=new Bundle();MainActivity activity=null;int result=-1;
        try{
            check(!"app.worldwide".equals(getTargetContext().getPackageName()),"Orientation test requires a disposable app package");
            activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitForPage(activity);
            checkStatusBarClearance(activity);
            run(this,activity);
            report.putString("stream","Portrait entry/login, landscape map, rejected orientation modes, and portrait sign-out passed.\n");
        }catch(Throwable error){
            result=1;java.io.StringWriter trace=new java.io.StringWriter();error.printStackTrace(new java.io.PrintWriter(trace));
            report.putString("stream","Orientation test failed: "+trace+"\n");
        }finally{if(activity!=null){MainActivity value=activity;runOnMainSync(value::finish);}}
        finish(result,report);
    }
    private void waitForPage(MainActivity activity)throws Exception{
        Field field=MainActivity.class.getDeclaredField("web");field.setAccessible(true);
        for(int attempt=0;attempt<100;attempt++){
            CountDownLatch completed=new CountDownLatch(1);AtomicBoolean ready=new AtomicBoolean();
            runOnMainSync(()->{
                try{WebView web=(WebView)field.get(activity);web.evaluateJavascript("Boolean(document.querySelector('.connection-screen, .account-welcome form, .map-app, .account-recovery-note'))",value->{ready.set("true".equals(value));completed.countDown();});}
                catch(Exception error){completed.countDown();}
            });
            if(completed.await(1,TimeUnit.SECONDS)&&ready.get()){waitForIdleSync();return;}
            Thread.sleep(50);
        }
        throw new AssertionError("Bundled entry or album page did not become ready");
    }
    private static void check(boolean condition,String label){if(!condition)throw new AssertionError(label);}
    private void checkStatusBarClearance(MainActivity activity)throws Exception{
        Field field=MainActivity.class.getDeclaredField("web");field.setAccessible(true);
        CountDownLatch completed=new CountDownLatch(1);AtomicBoolean fullMap=new AtomicBoolean(),clearHeader=new AtomicBoolean();
        runOnMainSync(()->{
            try{
                WebView web=(WebView)field.get(activity);
                android.view.View content=activity.findViewById(android.R.id.content);
                fullMap.set(web.getWidth()==content.getWidth()&&web.getHeight()==content.getHeight()
                    &&web.getPaddingTop()==0&&web.getPaddingLeft()==0&&web.getPaddingRight()==0&&web.getPaddingBottom()==0);
                int[] position=new int[2];web.getLocationOnScreen(position);
                android.view.WindowInsets insets=activity.getWindow().getDecorView().getRootWindowInsets();
                int top=android.os.Build.VERSION.SDK_INT>=30
                    ?insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout()).top
                    :insets.getSystemWindowInsetTop();
                float required=Math.max(0,top-position[1])/activity.getResources().getDisplayMetrics().density;
                web.evaluateJavascript("Boolean(document.querySelector('.atlas-brand')?.getBoundingClientRect().top >= "+required+" && document.querySelector('.top-controls')?.getBoundingClientRect().top >= "+required+")",value->{clearHeader.set("true".equals(value));completed.countDown();});
            }catch(ReflectiveOperationException error){completed.countDown();}
        });
        check(completed.await(10,TimeUnit.SECONDS),"Header clearance measured");
        check(fullMap.get(),"Water and map retain the complete viewport without inset margins");
        check(clearHeader.get(),"Only the phone header clears the status bar");
    }
    private static int requested(Instrumentation test,MainActivity activity){
        AtomicInteger value=new AtomicInteger();
        test.runOnMainSync(()->value.set(activity.getRequestedOrientation()));
        return value.get();
    }
    private static void expect(Instrumentation test,MainActivity activity,int orientation,String label)throws Exception{
        for(int attempt=0;attempt<100;attempt++){
            test.waitForIdleSync();
            if(requested(test,activity)==orientation)return;
            Thread.sleep(20);
        }
        throw new AssertionError(label+": requested "+requested(test,activity));
    }
    static void run(Instrumentation test,MainActivity activity)throws Exception{
        check(!"app.worldwide".equals(test.getTargetContext().getPackageName()),"Orientation test requires a disposable app package");
        ActivityInfo manifest=test.getTargetContext().getPackageManager().getActivityInfo(activity.getComponentName(),0);
        check(manifest.screenOrientation==ActivityInfo.SCREEN_ORIENTATION_PORTRAIT,"Fresh entry starts upright in portrait");
        Class<?> type=Class.forName("app.worldwide.MainActivity$Bridge");
        Constructor<?> constructor=type.getDeclaredConstructor(MainActivity.class);constructor.setAccessible(true);
        Object bridge=constructor.newInstance(activity);
        Method orientation=type.getDeclaredMethod("setOrientation",String.class);orientation.setAccessible(true);
        check(orientation.isAnnotationPresent(JavascriptInterface.class),"Orientation is exposed to the trusted bundled page");
        int original=requested(test,activity);
        try{
            orientation.invoke(bridge,"portrait");
            expect(test,activity,ActivityInfo.SCREEN_ORIENTATION_PORTRAIT,"Entry/login stays upright");
            orientation.invoke(bridge,"portrait");
            expect(test,activity,ActivityInfo.SCREEN_ORIENTATION_PORTRAIT,"Repeated entry request stays stable");
            orientation.invoke(bridge,"landscape");
            expect(test,activity,ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE,"Map accepts either landscape direction");
            for(String invalid:new String[]{null,"","auto","reversePortrait","sensorLandscape","LANDSCAPE"," landscape "}){
                orientation.invoke(bridge,(Object)invalid);test.waitForIdleSync();
                check(requested(test,activity)==ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE,"Unsupported mode ignored");
            }
            orientation.invoke(bridge,"portrait");
            expect(test,activity,ActivityInfo.SCREEN_ORIENTATION_PORTRAIT,"Sign out returns to upright login");
        }finally{
            test.runOnMainSync(()->{if(!activity.isFinishing()&&!activity.isDestroyed())activity.setRequestedOrientation(original);});
        }
    }
}
