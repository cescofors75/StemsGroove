import "./globals.css";

export const metadata = {
  title: "Stems - Stem Separator",
  description: "4-stem separation with Next.js + Demucs",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
