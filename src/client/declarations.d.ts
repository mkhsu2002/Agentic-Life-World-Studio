declare module "mammoth/mammoth.browser" {
  const mammoth: typeof import("mammoth");
  export default mammoth;
  export const extractRawText: typeof mammoth.extractRawText;
  export const convertToHtml: typeof mammoth.convertToHtml;
  export const images: typeof mammoth.images;
}
