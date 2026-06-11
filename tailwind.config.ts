import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // リテラ風: ディープネイビー × ティール/シアン
        navy: {
          DEFAULT: '#171951',
          deep: '#0e0d3a',
          indigo: '#353b7e',
          slate: '#35537e',
        },
        teal: {
          DEFAULT: '#20c3ac',
          cyan: '#00b5c2',
          dark: '#1a5152',
          mid: '#298d94',
          light: '#3ead86',
        },
        ink: '#333333',
        sub: '#717171',
        line: '#e3e3e3',
        paper: '#fafafa',
        bluepaper: '#ecf3f5',
        // 既存クラス(text-brand-600 等)互換: ティール基調のランプに再マップ
        brand: {
          50: '#ecf7f5',
          100: '#d0f5f9',
          200: '#a5e9e0',
          300: '#6fdccb',
          400: '#3ead86',
          500: '#20c3ac',
          600: '#1b9e8c',
          700: '#177f72',
          800: '#155f59',
          900: '#134e4a',
        },
      },
      fontFamily: {
        sans: [
          'roboto',
          '"Noto Sans JP"',
          '"Hiragino Kaku Gothic Pro"',
          '"Yu Gothic Medium"',
          'YuGothic',
          'sans-serif',
        ],
        midmin: ['"Shippori Mincho"', 'serif'],
      },
      boxShadow: {
        soft: '0 0 3px 0 rgba(0,0,0,.15)',
        card: '0 1px 3px 0 rgba(0,0,0,.08), 0 0 0 1px rgba(0,0,0,.02)',
      },
      backgroundImage: {
        'teal-grad': 'linear-gradient(90deg, #1b809e 0%, #298d94 50%, #3ead86 100%)',
        'accent-grad': 'linear-gradient(90deg, #1155e3 0%, #a011e3 100%)',
        'navy-grad': 'linear-gradient(90deg, #171951, #224e5f, #39625d)',
      },
    },
  },
  plugins: [],
};
export default config;
