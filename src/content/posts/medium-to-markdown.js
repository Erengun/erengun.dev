import { convertFromUrl } from 'medium-to-markdown';
 
convertFromUrl('https://erengun.medium.com/making-texts-selectable-in-your-flutter-web-app-7e682931efd9')
.then(function (markdown) {
  console.log(markdown); //=> Markdown content of medium post
});