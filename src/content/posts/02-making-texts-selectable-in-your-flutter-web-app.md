---
title: "Making Texts Selectable in Your Flutter Web App"
publishedAt: 2023-07-25
description: "Flutter is a powerful framework for building cross-platform mobile and web applications. When developing Flutter web apps, you may encounter situations where you want to allow users to select and copy text displayed on the screen."
slug: "making-texts-selectable"
isPublish: true
---

Making Texts Selectable in Your Flutter Web App (updated)
=========================================================

4 min read·Jul 25, 2023

Flutter is a powerful framework for building cross-platform mobile and web applications. When developing Flutter web apps, you may encounter situations where you want to allow users to select and copy text displayed on the screen. In this updated article, we’ll explore how to achieve this functionality using the `SelectableText` widget, the `DefaultTextStyle` widget, and the new `SelectionArea` widget introduced in Flutter 3.3.

Section 1: Getting Started with Flutter Web
-------------------------------------------

Before we dive into making texts selectable, let’s ensure that you have Flutter set up for web development. If you haven’t already enabled web support, run the following command:

```dart
flutter config --enable-web
```

This enables you to develop and run your Flutter app on the web platform.

Section 2: Using the SelectableText Widget
------------------------------------------

The `SelectableText` widget is a built-in Flutter widget that allows users to select and copy text from within the widget. Let's see how to use it to make specific text elements selectable:

```dart
import 'package:flutter/material.dart';  
  
class SelectableTextExample extends StatelessWidget {  
  @override  
  Widget build(BuildContext context) {  
    return Scaffold(  
      appBar: AppBar(  
        title: Text('Selectable Text Example'),  
      ),  
      body: Center(  
        child: SelectableText(  
          'This text is selectable. Long-press and drag to select it.',  
          style: TextStyle(fontSize: 20.0),  
        ),  
      ),  
    );  
  }  
}
```

In the example above, we’ve created a simple `SelectableText` widget with a custom text style. Users can now long-press and drag to select the text within the widget.

Section 3: Making All Text Selectable in Project
------------------------------------------------

If you want to make every text element within your Flutter web app selectable without manually adding `SelectableText` widgets, you can use the `DefaultTextStyle` widget. However, in Flutter 3.3, you can now use the `SelectionArea` widget to enable selection for any child widget.

```dart
import 'package:flutter/material.dart';  
  
void main() {  
  runApp(MyApp());  
}  
  
class MyApp extends StatelessWidget {  
  @override  
  Widget build(BuildContext context) {  
    return MaterialApp(  
      home: SelectionArea(  
        child: Scaffold(  
          appBar: AppBar(  
            title: Text('Selectable Text App'),  
          ),  
          body: Center(  
            child: Text('This text is selectable. Long-press and drag to select it.'),  
          ),  
        ),  
      ),  
    );  
  }  
}
```

By wrapping your `MaterialApp` with `SelectionArea`, all text widgets within the app will have selection enabled. Users can long-press and drag to select any text within the app.

Section 4: Fine-Tuning SelectableText Behavior
----------------------------------------------

While `DefaultTextStyle` and `SelectionArea` offer quick and convenient ways to make text selectable, you may encounter situations where you need more control over text selection. In such cases, you can use the `SelectableText.rich()` constructor for more advanced scenarios or explore third-party packages that offer additional text selection features.

```dart
import 'package:flutter/material.dart';  
  
class SelectableTextRichExample extends StatelessWidget {  
  @override  
  Widget build(BuildContext context) {  
    return Scaffold(  
      appBar: AppBar(  
        title: Text('Selectable Text Rich Example'),  
      ),  
      body: Center(  
        child: SelectableText.rich(  
          TextSpan(  
            text: 'This is a selectable rich text. ',  
            style: TextStyle(fontSize: 20.0),  
            children: \[  
              TextSpan(  
                text: 'You can select individual spans of text.',  
                style: TextStyle(fontWeight: FontWeight.bold),  
              ),  
            \],  
          ),  
        ),  
      ),  
    );  
  }  
}
```

In the example above, we’ve used the `SelectableText.rich()` constructor to create a selectable rich text widget. Users can now select individual spans of text within the widget.

Bonus Section: Adding Contextual Action to Selected Text
--------------------------------------------------------

In some scenarios, you might want to add contextual actions to the selected text. This could be copying the text to the clipboard, translating the text, or looking up the definition of a selected word. The `SelectableText` widget does not provide this functionality out of the box, but you can achieve it by using the `showMenu` function in Flutter.

Here’s an example of how you can add a “Copy” action to the selected text:

```dart
import 'package:flutter/material.dart';  
  
class SelectableTextWithCopyAction extends StatefulWidget {  
  @override  
  \_SelectableTextWithCopyActionState createState() => \_SelectableTextWithCopyActionState();  
}  
  
class \_SelectableTextWithCopyActionState extends State<SelectableTextWithCopyAction> {  
  final TextEditingController \_controller = TextEditingController();  
  @override  
  Widget build(BuildContext context) {  
    return Scaffold(  
      appBar: AppBar(  
        title: Text('Selectable Text with Copy Action'),  
      ),  
      body: Center(  
        child: SelectableText(  
          'This text is selectable. Long-press and drag to select it.',  
          style: TextStyle(fontSize: 20.0),  
          onTap: () async {  
            final selectedText = \_controller.selection.textInside(\_controller.text);  
            final copyAction = PopupMenuItem<String>(  
              value: 'copy',  
              child: Row(  
                children: <Widget>\[  
                  Icon(Icons.content\_copy),  
                  SizedBox(width: 8.0),  
                  Text('Copy'),  
                \],  
              ),  
            );  
            final selectedAction = await showMenu<String>(  
              context: context,  
              position: RelativeRect.fill,  
              items: <PopupMenuEntry<String>>\[copyAction\],  
            );  
            if (selectedAction == 'copy') {  
              Clipboard.setData(ClipboardData(text: selectedText));  
            }  
          },  
        ),  
      ),  
    );  
  }  
}
```

In the example above, we’ve created a `SelectableText` widget and added an `onTap` handler. When the user taps on the selected text, a context menu with a "Copy" action appears. If the user selects the "Copy" action, the selected text is copied to the clipboard.

This is just one example of how you can add contextual actions to selected text. Depending on your app’s requirements, you could add other actions like “Translate”, “Define”, or “Search”.

Remember, the goal is to enhance the user experience by making your app more interactive and user-friendly. So, feel free to experiment with different actions and find what works best for your app.

Conclusion:
-----------

Making text selectable in a Flutter web app is crucial for improving user experience and providing accessibility. You can use the built-in `SelectableText` widget for selective text selection, wrap your entire app with `SelectionArea` for global selection, or use `SelectableText.rich()` for more advanced scenarios. However, consider the trade-offs in each method and choose the approach that best suits your app's requirements.

By enabling text selection, you’ll enhance the usability of your Flutter web app, making it more user-friendly and feature-rich. Happy coding!

Sources:

*   [fluttercampus.com](https://www.fluttercampus.com/guide/340/selectable-copy-text-widget-flutter/)
*   [github.com](https://github.com/flutter/flutter/issues/38474)
*   [protocoderspoint.com](https://protocoderspoint.com/flutter-selectabletext-widget-example/)
*   [googleflutter.com](https://googleflutter.com/flutter-selectabletext/)
*   [stackoverflow.com](https://www.fluttercampus.com/guide/340/selectable-copy-text-widget-flutter/)
*   [api.flutter.dev](https://github.com/flutter/flutter/issues/38474)
*   [api.flutter.dev](https://protocoderspoint.com/flutter-selectabletext-widget-example/)
*   [pub.dev](https://googleflutter.com/flutter-selectabletext/)
