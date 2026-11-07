export type ModelLook = {
  exposure: number;
  detail: number;
  rolloff: number;
  edgeCleanup: number;
  diffusion: number;
};

export const neutralLook: Readonly<ModelLook> = {
  exposure: 0, detail: 0, rolloff: 0, edgeCleanup: 0, diffusion: 0,
};
export const lookPresets = [
  { name: "干净线稿", look: { exposure: 0, detail: .56, rolloff: .12, edgeCleanup: .7, diffusion: 0 } },
  { name: "柔和肖像", look: { exposure: .17, detail: .2, rolloff: .34, edgeCleanup: .45, diffusion: .42 } },
  { name: "高光保护", look: { exposure: .28, detail: .25, rolloff: .72, edgeCleanup: .35, diffusion: .14 } },
] as const;

// Original SDR shader: work in straight RGB with alpha-weighted neighbourhoods.
// Local contrast controls sharpening; the highlight shoulder scales all RGB channels together.
export const lookFragment = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize,inputClamp;
uniform float exposure,detail,rolloff,edgeCleanup,diffusion,pixelScale;
vec4 at(vec2 offset) {
  return texture2D(uSampler,clamp(vTextureCoord+offset,inputClamp.xy,inputClamp.zw));
}
vec3 rgb(vec4 c) { return c.rgb/max(c.a,0.0001); }
float luma(vec3 c) { return dot(c,vec3(0.2126,0.7152,0.0722)); }
void main() {
  vec4 src=at(vec2(0.0));
  if(src.a<0.0001) { gl_FragColor=src; return; }
  vec3 c=rgb(src);
  vec2 dx=vec2(inputSize.z*pixelScale,0.0),dy=vec2(0.0,inputSize.w*pixelScale);
  if(detail>0.0 || edgeCleanup>0.0) {
    vec4 a=at(dx),b=at(-dx),d=at(dy),e=at(-dy);
    vec3 local=rgb(a+b+d+e);
    float strongest=max(max(a.a,b.a),max(d.a,e.a));
    vec3 ca=mix(c,rgb(a),a.a),cb=mix(c,rgb(b),b.a),cd=mix(c,rgb(d),d.a),ce=mix(c,rgb(e),e.a);
    vec3 lo=min(c,min(min(ca,cb),min(cd,ce)));
    vec3 hi=max(c,max(max(ca,cb),max(cd,ce)));
    float contrast=max(0.0,luma(hi-lo));
    float gain=detail*(1.0-smoothstep(0.10,0.46,contrast))*smoothstep(0.62,0.98,src.a);
    c=clamp(c+(c-local)*gain,lo-0.055,hi+0.055);
    c=mix(c,local,edgeCleanup*(1.0-src.a)*smoothstep(0.1,0.5,strongest-src.a));
  }
  if(diffusion>0.0) {
    vec4 near=at(dx*3.0)+at(-dx*3.0)+at(dy*3.0)+at(-dy*3.0);
    vec4 far=at((dx+dy)*7.0)+at(-(dx+dy)*7.0)+at((dx-dy)*7.0)+at(-(dx-dy)*7.0);
    vec3 soft=rgb(near*0.65+far*0.35);
    c=mix(c,max(c,soft),smoothstep(0.45,0.94,luma(soft))*diffusion*0.42);
  }
  vec3 linear=pow(max(c,0.0),vec3(2.2))*exp2(exposure);
  float peak=max(linear.r,max(linear.g,linear.b));
  float knee=0.66;
  if(peak>knee) {
    float d=peak-knee;
    float rolled=knee+d/(1.0+d/(1.0-knee));
    linear*=mix(peak,rolled,rolloff)/peak;
  }
  gl_FragColor=vec4(pow(clamp(linear,0.0,1.0),vec3(1.0/2.2))*src.a,src.a);
}`;
