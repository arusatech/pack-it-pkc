export interface PdfWord {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

export interface PdfPageLike {
  width: number;
  words: PdfWord[];
}
