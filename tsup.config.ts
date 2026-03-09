import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    'react',
    'react-native',
    'expo-updates',
    '@openfeature/core',
    '@openfeature/react-sdk',
    '@react-native-async-storage/async-storage',
  ],
})
