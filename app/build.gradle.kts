plugins {
    id("com.android.application")
}

android {
    namespace = "com.remriel.dictatask"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.remriel.dictatask"
        minSdk = 26
        targetSdk = 36
        versionCode = 20
        versionName = "1.5.34"
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            // Produces an installable internal-review APK. Play releases should use the owner's key.
            signingConfig = signingConfigs.getByName("debug")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.activity:activity:1.13.0")
    // Core 1.19 requires compileSdk 37 and AGP 9.1; this project intentionally targets 36.
    //noinspection GradleDependency
    implementation("androidx.core:core:1.18.0")
    implementation("androidx.webkit:webkit:1.17.0")
    testImplementation("junit:junit:4.13.2")
}
