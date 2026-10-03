// Bundled image assets (Metro resolves these to an asset id usable as an Image source).
declare module "*.png" {
  const asset: number;
  export default asset;
}
