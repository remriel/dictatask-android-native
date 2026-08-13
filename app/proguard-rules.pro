# The bundled UI calls these bridge methods by their annotated Java names.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
