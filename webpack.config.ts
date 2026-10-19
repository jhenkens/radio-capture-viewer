import path from "path";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import HtmlWebpackPlugin from "html-webpack-plugin";
import type { Configuration } from "webpack";

const config: Configuration = {
  entry: "./src/client/main.ts",
  output: {
    path: path.resolve(__dirname, "dist/public"),
    filename: "bundle.[contenthash].js",
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        // Transpile only: TypeScript 7 has no JS API for ts-loader, and `npm run build:client`
        // type-checks with `tsc --noEmit` first.
        loader: "esbuild-loader",
        options: { target: "es2020" },
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, "css-loader", "postcss-loader"],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: "styles.[contenthash].css",
    }),
    new HtmlWebpackPlugin({
      template: "./src/client/index.html",
      filename: "index.html",
      minify: false, // html-minifier-terser breaks on Alpine.js event attributes
    }),
  ],
};

export default config;
