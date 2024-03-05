---
title: "Material Symbols Icons for Flutter: A Comprehensive Guide"
publishedAt: 2024-03-05
description: "With the continuous evolution of Flutter and the demand for visually appealing, high-quality icons in mobile applications, integrating Google's Material Symbols Icons into your Flutter project has become a must-have for developers. The `material_symbols_icons` package by hiveright.tech offers a seamless way to incorporate these icons into your Flutter applications, providing a wide range of options for customization and compatibility with future Flutter updates."
slug: "using-material-library-icons-in-flutter-app"
isPublish: true
---
# Material Symbols Icons for Flutter: A Comprehensive Guide

## Introduction

With the continuous evolution of Flutter and the demand for visually appealing, high-quality icons in mobile applications, integrating Google's Material Symbols Icons into your Flutter project has become a must-have for developers. The `material_symbols_icons` package by hiveright.tech offers a seamless way to incorporate these icons into your Flutter applications, providing a wide range of options for customization and compatibility with future Flutter updates.

## Why Material Symbols Icons?

- **Official Version**: Utilizes the official Material Symbols Icons variable fonts version 2.719 released on 02/01/2024, boasting 3479 icons.
- **Interactive Icon Map**: Offers a complete interactive icon map for easy exploration and selection of icons.
- **Full Variation Support**: Includes full variation support and automatic code generation for updating icon definition files.
- **Future Compatibility**: Designed to be completely compatible with the future Flutter 'native' implementation of Material Symbols Icons support.

## Live Example:
Check out a live [flutter web example](https://timmaffett.github.io/material_symbols_icons/) of the package here to test icon availability and experiment with different style variations.


### Installation

To integrate Material Symbols Icons into your Flutter project, add the `material_symbols_icons` package to your `pubspec.yaml` file:

```yaml
dependencies:
 material_symbols_icons: ^latest_version
```

Run `flutter pub get` to fetch the package.

### Basic Usage

To use an icon, import the package and reference the icon using the `Symbols` class:

```dart
import 'package:material_symbols_icons/symbols.dart';

final myIcon = Icon(Symbols.add_task);
```

## Exploring Icon Variations

Material Symbols Icons come in three main styles: Outlined, Rounded, and Sharp. Each style offers a unique visual appeal, allowing developers to choose the best fit for their app's design:

```dart
final myRoundedIcon = Icon(Symbols.add_task_rounded);
final mySharpIcon = Icon(Symbols.add_task_sharp);
```

## Customizing Icons

The package allows for extensive customization of icons using the weight, grade, and fill axes. For example, to create a bold, emphasized icon with a solid fill, you could use:

```dart
final myCustomizedIcon = Icon(
 Symbols.settings,
 fill: 1,
 weight: 700,
 grade: 0.25,
 opticalSize: 48,
);
```

## Setting Default Icon Variations

For a consistent look across your app, you can set default icon variations using `MaterialSymbolsBase.setOutlinedVariationDefaults`, `MaterialSymbolsBase.setRoundedVariationDefaults`, and `MaterialSymbolsBase.setSharpVariationDefaults`. This ensures that all icons in your app follow a uniform style:

```dart
MaterialSymbolsBase.setOutlinedVariationDefaults(
 color: Colors.red,
 fill: 1,
 weight: 300,
 grade: 0,
 opticalSize: 40.0,
);
```

## Conclusion

Material Symbols Icons offer a powerful, customizable solution for developers looking to enhance their Flutter apps with high-quality, modern icons. By leveraging the `material_symbols_icons` package, you can easily incorporate these icons into your projects, ensuring a visually appealing and intuitive user experience.

Whether you're building a new app from scratch or looking to refresh an existing one, Material Symbols Icons provide the tools and flexibility needed to create a stunning and functional interface. Start exploring the wide range of icons and customization options available and elevate your app's design today.
