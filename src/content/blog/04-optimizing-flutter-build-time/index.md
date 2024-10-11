---
title: "Why is Flutter Build Taking So Long? Tips to Speed Up Your Flutter Build Time"
summary: "As your project grows, long build times can slow down productivity. As a 2017 MBP user in 2024 myself. I’ve been through the pain of waiting for builds that felt like they would never end. So, after diving deep into optimization strategies, I found a few key things that can speed up the process."
date: "Oct 2024"
draft: false
tags:
- Flutter
- Optimization
- Firebase
---
Why is Flutter Build Taking So Long? Tips to Speed Up Your Flutter Build Time
=============================================================================

<div style="width:100%;height:0;padding-bottom:56%;position:relative;"><iframe src="https://giphy.com/embed/QMHoU66sBXqqLqYvGO" width="100%" height="100%" style="position:absolute" frameBorder="0" class="giphy-embed" allowFullScreen></iframe></div><p><a href="https://giphy.com/gifs/this-is-fine-QMHoU66sBXqqLqYvGO">via GIPHY</a></p>

As your project grows, long build times can slow down productivity. As a 2017 MBP user in 2024 myself. I’ve been through the pain of waiting for builds that felt like they would never end. So, after diving deep into optimization strategies, I found a few key things that can speed up the process.

1\. Pre-Compiled Firestore iOS SDK: A Life Saver
================================================

When I first added Firebase Firestore to one of my projects, I didn’t realize how much it would affect my build times on iOS. Every time I hit “build,” I could go make coffee and come back before it was done. It wasn’t until I switched to using **pre-compiled Firestore iOS SDKs** that things started speeding up. By doing this, the project doesn’t need to recompile Firestore every time I build for iOS. The result? See yourself

Why Use Pre-Compiled Firestore?
-------------------------------

By default, the Firestore iOS SDK compiles from source each time you build your app. While that might not seem like a big deal at first, those 500k lines of code really add up, leading to long build times even after incremental changes. The pre-compiled version avoids this, allowing you to integrate Firestore without needing to recompile its dependencies every time you build for iOS.

[How Much Time Can It Save?](https://github.com/invertase/firestore-ios-sdk-frameworks?tab=readme-ov-file#before--after)
------------------------------------------------------------------------------------------------------------------------

**Mac mini (2018) with 6 cores:**

```
Before:    ~ 240s  
After:     ~ 45s
```

That’s a **200+ second improvement** on a local Mac. Not bad!

How to Use Pre-Compiled Firestore SDK in Your Project
-----------------------------------------------------

Integrating the pre-compiled SDK is surprisingly easy. All you need to do is add one line to your `Podfile` for your iOS project. In Flutter, you’ll usually find this file under `ios/Podfile`.

Here’s what you need to add:

```bash
pod 'FirebaseFirestore', :git => 'https://github.com/invertase/firestore-ios-sdk-frameworks.git', :tag => '10.19.0'
```

> **_⚠️ Important:_** _The version number (_`_10.19.0_`_) should match the Firestore version you're using. If you’re working with FlutterFire, you can check which version you need_ [_here_](https://github.com/FirebaseExtended/flutterfire/blob/master/packages/firebase_core/firebase_core/ios/firebase_sdk_version.rb)_._

Once you run `pod install`, CocoaPods will retrieve the pre-compiled binary and use it instead of compiling Firestore from scratch. This one change can shave **minutes** off your build times, and over the course of a project, those minutes really add up!

2\. Use your phone as Emulator
==============================

When working with devices during development, emulators really slow downs the computer. I fount the solution with using [scrcpy](https://github.com/Genymobile/scrcpy), a lightweight and fast tool that allows you to mirror and control your Android device via USB or Wifi Debugging. So basically instead of using your computers resources for emulator you can use your phone. It’s an efficient alternative to traditional emulators and helps you test changes easily.

<div style="width:100%;height:0;padding-bottom:56%;position:relative;"><iframe src="https://giphy.com/embed/7rGC9Ee1MlIv4hn9Ze" width="100%" height="100%" style="position:absolute" frameBorder="0" class="giphy-embed" allowFullScreen></iframe></div><p><a href="https://giphy.com/gifs/cbs-young-sheldon-youngsheldon-good-thinking-7rGC9Ee1MlIv4hn9Ze">via GIPHY</a></p>

You can also optimize the scrcpy too by configuring. This is the command I use:

```
scrcpy --video-codec=h265 --max-size=1920 --max-fps=90 --no-audio --keyboard=uhid
```

Similarly, using **Project IDX**, Google’s cloud-based developer platform, can offer a seamless dev environment, further reducing your dependency on local emulators.


2\. Creating `build.yaml` for Faster Builds
===========================================

As my Flutter projects grew, code generation started to slow down my Mac, especially when using tools like `json_serializable` or `freezed`. Managing large amounts of generated code is not only tedious, but it can also lead to **longer build times**. That’s where `**build.yaml**` comes.

To get started, you’ll need to create a `**build.yaml**` file at the root of your Flutter project, next to your `pubspec.yaml` file. This file doesn't come by default when running `flutter create`, so you'll have to manually create it.

Specify the Files for Code Generation
-------------------------------------

One of the best ways to reduce build time is to specify exactly which files should be processed by your code generators. For instance, if you’re using `json_serializable`, you can explicitly list the files where you want code generation to happen.

Here’s a quick example:

```yaml
targets:  
  $default:  
    builders:  
      json\_serializable|json\_serializable:  
        generate\_for:  
          - "lib/models/user.dart"  
          - "lib/models/post.dart"
```

By doing this, you limit the scope of the code generator to just these two files, rather than letting it analyze your entire codebase. This saves time, especially in larger projects.

You can also use **wildcards** to match file patterns. For example, if you have a whole folder of models:

```yaml
targets:  
  $default:  
    builders:  
      json\_serializable|json\_serializable:  
        generate\_for:  
          - "\*\*/models/\*\*.dart"
```

This will generate code for all `.dart` files inside the `models` folder, allowing you to scale easily as your project grows.

Enable or Disable Builders
--------------------------

If there are builders that you don’t need to run every time, you can disable them in `build.yaml` to further reduce build time. For instance, if you're using `freezed` but don’t need it on every build, you can do something like this:

```yaml
targets:  
  $default:  
    builders:  
      freezed|freezed:  
        enabled: false
```

This stops the `freezed` generator from running, allowing you to activate it only when needed.

4\. Running Your Project on the Web with Mobile Layout
======================================================

If you’re working on UI elements or quick iterations, running your Flutter project on the **web** can be much faster than building for mobile. You can leverage **web sizing** in DevTools to adjust the layout to mobile screen sizes while enjoying the faster build times of a web environment. This gives you quicker feedback, especially for frontend work.

*   **Open DevTools**: Once your app is running, you can open the Chrome DevTools by right-clicking on your application and selecting **Inspect** or using the shortcut `Ctrl + Shift + I` (Windows) or `Cmd + Option + I` (Mac).
*   **Use Device Toolbar**: In the DevTools panel, click on the **Toggle device toolbar** button (the icon that looks like a mobile device) or use the shortcut `Ctrl + Shift + M` (Windows) or `Cmd + Shift + M` (Mac). This feature allows you to view your application in various device sizes.
*   **Select Device Presets**: Once the device toolbar is active, you’ll see a dropdown menu at the top where you can choose from a variety of device presets (e.g., iPhone, Pixel, iPad). Selecting a preset adjusts the viewport size to match the device’s specifications, giving you a clear view of how your application looks on that device.
*   **Custom Viewports**: If you want to test custom sizes, you can manually enter width and height dimensions in the responsive mode. This flexibility allows you to simulate any screen size, ensuring that your application remains user-friendly on devices of all shapes and sizes.

5\. Check for Unnecessary `pub` Packages
========================================

Over time, it’s easy to accumulate dependencies in your `pubspec.yaml` that you no longer use. These extra dependencies can slow down your build process. Make it a habit to **audit your dependencies** and remove unused packages. This not only speeds up builds, but also reduces the overall size of your app.

6\. Run Flutter in Verbose Mode (`-v` Option)
=============================================

When your builds take too long, it’s often hard to figure out why. Running Flutter in **verbose mode** (`flutter build -v`) provides detailed logs about what’s happening during the build process. This helps you identify bottlenecks and take action to streamline specific phases that are slowing things down.

Conclusion
==========

As we reach the end of this journey through optimizing Flutter build times, I hope you’ve found a few valuable tools to help you navigate the complexities of development.

If you appreciate the insights shared here and want to see more content and projects, consider following me or sponsoring my work on [GitHub](https://github.com/Erengun). Together, we can explore new horizons in development and craft solutions that resonate with our community.

<div style="width:100%;height:0;padding-bottom:75%;position:relative;"><iframe src="https://giphy.com/embed/XxHVJxuogNP32" width="100%" height="100%" style="position:absolute" frameBorder="0" class="giphy-embed" allowFullScreen></iframe></div><p><a href="https://giphy.com/gifs/XxHVJxuogNP32">via GIPHY</a></p>
