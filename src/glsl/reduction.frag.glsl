#version 300 es
precision highp float;

out vec4 fragColor;

uniform sampler2D uInput;
uniform vec2 uTexelSize;

void main() {
    vec2 uv = gl_FragCoord.xy * uTexelSize;
    vec4 a = texture(uInput, uv);
    fragColor = a;
}
