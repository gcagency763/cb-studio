"""Separa a voz da música com o modelo UVR MDX-Net Kim_Vocal_2 (ONNX, CPU).
uso: python3 sep_vocals.py modelo.onnx entrada.wav saida_voz.wav"""
import sys

import numpy as np
import onnxruntime as ort
import soundfile as sf

MODEL, IN, OUT = sys.argv[1:4]
N_FFT, HOP, DIM_F, DIM_T, COMP = 7680, 1024, 3072, 256, 1.009
N_BINS = N_FFT // 2 + 1
CHUNK = HOP * (DIM_T - 1)
TRIM = N_FFT // 2
GEN = CHUNK - 2 * TRIM
WIN = np.hanning(N_FFT + 1)[:-1].astype(np.float32)  # hann periódica (igual ao torch)


def stft(x):  # x: (C, CHUNK) -> (C, N_BINS, DIM_T) complexo, center=True reflect
    p = np.pad(x, ((0, 0), (N_FFT // 2, N_FFT // 2)), mode="reflect")
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(DIM_T)[:, None]
    frames = p[:, idx] * WIN  # (C, T, N_FFT)
    return np.fft.rfft(frames, axis=-1).transpose(0, 2, 1)


def istft(X):  # (C, N_BINS, T) -> (C, CHUNK)
    frames = np.fft.irfft(X.transpose(0, 2, 1), n=N_FFT, axis=-1) * WIN
    L = N_FFT + HOP * (DIM_T - 1)
    out = np.zeros((X.shape[0], L), np.float64)
    wsum = np.zeros(L, np.float64)
    for t in range(DIM_T):
        out[:, t * HOP:t * HOP + N_FFT] += frames[:, t]
        wsum[t * HOP:t * HOP + N_FFT] += WIN ** 2
    out /= np.maximum(wsum, 1e-8)
    return out[:, N_FFT // 2:N_FFT // 2 + CHUNK]


mix, sr = sf.read(IN, always_2d=True)
assert sr == 44100, sr
mix = mix.T.astype(np.float32)
if mix.shape[0] == 1:
    mix = np.repeat(mix, 2, axis=0)
n = mix.shape[1]
pad = GEN - n % GEN
mixp = np.concatenate([np.zeros((2, TRIM)), mix, np.zeros((2, pad)), np.zeros((2, TRIM))], axis=1).astype(np.float32)

sess = ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"])
parts = []
for i in range(0, n + pad, GEN):
    w = mixp[:, i:i + CHUNK]
    S = stft(w)  # (2, N_BINS, T)
    spec = np.stack([S.real, S.imag], axis=1)  # (2ch, 2ri, F, T)
    spec = spec.reshape(1, 4, N_BINS, DIM_T)[:, :, :DIM_F].astype(np.float32)
    pred = sess.run(None, {"input": spec})[0]
    pred = np.concatenate([pred, np.zeros((1, 4, N_BINS - DIM_F, DIM_T), np.float32)], axis=2)
    pred = pred.reshape(2, 2, N_BINS, DIM_T)
    Y = pred[:, 0] + 1j * pred[:, 1]
    parts.append(istft(Y)[:, TRIM:-TRIM])
voc = np.concatenate(parts, axis=1)[:, :n] * COMP
sf.write(OUT, voc.mean(axis=0), sr)
print("ok", OUT, round(n / sr, 2), "s")
