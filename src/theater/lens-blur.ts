// A normalized aperture gather over premultiplied RGBA. Outside pixels contribute
// transparent black rather than a clamped edge, preserving soft alpha silhouettes.
export const lensFragment = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 inputClamp;
uniform float radius;
uniform float samples;
uniform float highlight;
vec4 sampleAt(vec2 uv){
  if(uv.x<inputClamp.x||uv.y<inputClamp.y||uv.x>inputClamp.z||uv.y>inputClamp.w)return vec4(0.0);
  return texture2D(uSampler,uv);
}
void main(){
  vec4 sum=vec4(0.0);float weights=0.0;
  for(int i=0;i<64;i++){
    float fi=float(i);if(fi>=samples)break;
    float r=sqrt((fi+0.5)/samples),angle=fi*2.3999632297;
    vec2 delta=vec2(cos(angle),sin(angle))*r*radius*inputSize.zw;
    vec4 c=sampleAt(vTextureCoord+delta);
    vec3 straight=c.rgb/max(c.a,0.0001);
    float luminance=dot(straight,vec3(.2126,.7152,.0722));
    float weight=1.0+highlight*4.0*pow(max(0.0,luminance-.65)/.35,2.0)*c.a;
    sum+=c*weight;weights+=weight;
  }
  gl_FragColor=sum/max(weights,0.0001);
}`;
export function gaussianSettings(radius: number, exact: boolean) {
  return {
    radius: Math.max(0, radius),
    quality: exact ? 6 : 4,
    resolution: 1,
    kernelSize: 15,
  };
}
