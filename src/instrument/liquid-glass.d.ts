export interface GlassPreset {
  refThickness: number;
  refFactor: number;
  /** per-channel offset gain — the chromatic aberration */
  refDispersion: number;
  refFresnelRange: number;
  refFresnelHardness: number;
  refFresnelFactor: number;
  glareRange: number;
  glareHardness: number;
  glareFactor: number;
  glareConvergence: number;
  glareOppositeFactor: number;
  /** degrees */
  glareAngle: number;
  /** gaussian radius on the backdrop; 1 = clear, 20-40 = frosted */
  blurRadius: number;
  blurEdge: boolean;
  /** '#rrggbb' */
  tintColor: string;
  /** 0-100 */
  tintAlpha: number;
  shadowExpand: number;
  /** 0-100 */
  shadowFactor: number;
  shadowX: number;
  /** negative drops the shadow below the shape */
  shadowY: number;
  /** superellipse exponent: 2 = circular corners, 5 = squircle */
  shapeRoundness: number;
  /** 0-0.3; >0 fuses nearby shapes */
  mergeRate: number;
  borderEnabled: boolean;
  borderWidth: number;
  /** 0-100 */
  borderIntensity: number;
}

export interface GlassShapeRect {
  /** css px, relative to the canvas, top-left origin */
  x: number;
  y: number;
  width: number;
  height: number;
  /** corner radius in css px; defaults to 12 */
  radius?: number;
  /** overrides preset.shapeRoundness for this shape */
  roundness?: number;
  /** 0..1 weight for the white border highlight on this shape; default 0 */
  border?: number;
}

export interface GlassSourceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LiquidGlassOptions {
  preset?: Partial<GlassPreset>;
  /** device pixel ratio ceiling; defaults to 2 */
  maxDpr?: number;
  /** rgb 0-1 shown where the source does not reach; defaults to black */
  voidColor?: [number, number, number];
  mirror?: boolean;
}

export type GlassSource =
  | HTMLVideoElement
  | HTMLImageElement
  | HTMLCanvasElement
  | null;

export declare class LiquidGlass {
  constructor(canvas: HTMLCanvasElement, options?: LiquidGlassOptions);
  readonly gl: WebGL2RenderingContext;
  setPreset(partial: Partial<GlassPreset>): this;
  getPreset(): GlassPreset;
  setSource(source: GlassSource, rect?: GlassSourceRect | null): this;
  setMirror(on: boolean): this;
  /** 0..1 dimming applied to the backdrop before refraction */
  setShade(v: number): this;
  /** up to MAX_GLASS_SHAPES; extras are ignored */
  setShapes(shapes: GlassShapeRect[]): this;
  resize(): this;
  renderFrame(): void;
  start(): this;
  stop(): this;
  dispose(): void;
}

export declare const MAX_GLASS_SHAPES: number;
export default LiquidGlass;
