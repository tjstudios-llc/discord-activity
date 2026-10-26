import "./styles.css";

export const metadata = {
  title: "TeamSpace Studio",
  description: "Manage TeamSpace teams and workspaces.",
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
