/** @type {import('next').NextConfig} */
const nextConfig = {
  // unpdf usa pdf.js: lasciarlo esterno al bundle evita problemi di build.
  serverExternalPackages: ["unpdf"],
  // Assicura che i file dei prompt vengano inclusi nel bundle serverless su Vercel
  // (altrimenti fs.readFileSync non li troverebbe in produzione).
  outputFileTracingIncludes: {
    "/api/chat": ["./prompts/**/*"],
  },
};

export default nextConfig;
