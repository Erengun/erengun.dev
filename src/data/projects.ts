export type Project = {
  title: string;
  techs: string[];
  link: string;
  isComingSoon?: boolean;
};

const projects: Project[] = [
  {
    title: "Flutter Riverpod 2.0 Template",
    techs: ["Flutter", "Riverpod", "Freezed", "Go Router", "Dio", "Hive", "GetIt"],
    link: "https://github.com/Erengun/Flutter-Riverpod-2.0-Template",
  },
  {
    title: "Pati Pati App",
    techs: ["Flutter", "Firebase", "Riverpod", "Freezed", "Go Router", "Dio", "Hive", "GetIt"],
    link: "https://play.google.com/apps/testing/app.patipati",
  },
  {
    title: "Tinywall",
    techs: ["Flutter", "MobX", "Hive", "Dio", "GetIt", "MVVM", "Clean Architecture",],
    link: "https://tinywall.app",
  },
 
 
  {
    title: "Grog app",
    techs: ["Flutter", "Firebase", "Cloud Firestore", "Firebase Auth", "Firebase Functions", "Riverpod"],
    link: "/",
    isComingSoon: true,
  },
  {
    title: "GOHouse - Mobile app",
    techs: ["Flutter", "Firebase", "Cloud Firestore", "Firebase Auth", "GetIt"],
    link: "/",
  },
  
  {
    title: "Firebase Flutter Snippets",
    techs: ["Flutter", "Firebase", "Cloud Firestore", "Firebase Auth", "Firebase Functions"],
    link: "https://github.com/Erengun/snippets-flutter"
  },
  {
    title: "Browser Image Compression - Flutter Package",
    techs: ["Flutter", "Dart", "Image Compression"],
    link: "https://github.com/ChampionsGoal/browser_image_compression",
  }
];

export default projects;
