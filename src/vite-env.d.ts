/// <reference types="vite/client" />

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ImportMetaEnv {
  // Guestra backend URL will be configured here later.
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
