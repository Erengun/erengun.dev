type Social = {
  label: string;
  link: string;
};

type Presentation = {
  mail: string;
  title: string;
  description: string;
  socials: Social[];
  profile?: string;
};

const presentation: Presentation = {
  mail: "hi@erengun.dev",
  title: "Hi, I’m Eren Gün 👋",
  // profile: "/profile.webp",
  description:
    "Hello, I create and maintain *web and mobile applications* that provide seamless user experience and robust data handling capabilities. I love to work with *Flutter*, *Node.js*, *TypeScript*, and *Firebase*. I am currently working as a *Mobile Application Developer* at *Ofis.work*.",
  socials: [
    {
      label: "Linkedin",
      link: "https://www.linkedin.com/in/erengun",
    },
    {
      label: "Github",
      link: "https://github.com/Erengun",
    },
    {
      label: "Medium",
      link: "https://medium.com/@erengun",
    },
    {
      label: "Stack Overflow",
      link: "https://stackoverflow.com/users/18449412/eren-g%c3%bcn",
    },
    {
      label: "Resume",
      link: "https://drive.google.com/file/d/15STnxPXJfzzjb6T62ZBQu7r_KbGg7ESR/view?usp=sharing",
    }
  ],
};

export default presentation;
