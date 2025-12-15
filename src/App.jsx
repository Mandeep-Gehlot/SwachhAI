import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    Upload,
    Camera,
    Trash2,
    Loader2,
    Image as ImageIcon,
    Recycle,
    Leaf,
    Mic,
    Zap,
    PlayCircle,
    PauseCircle,
    ScanLine
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- Configuration ---
const GEMINI_API_KEY = "AIzaSyDGb9DuWMEeOgCdf7Yz6yElj-Hr8WTLOBc"; 
const INR_PER_USD = 83; 

// FIX: Use gemini-2.0-flash-exp (Supports both Vision and Audio Generation)
const MODEL_NAME = "gemini-2.0-flash-exp";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;

const MAX_RETRIES = 3;
const VOICE_CONFIGS = {
    'en-US': { name: 'Kore', label: 'English (US)' },
    'hi-IN': { name: 'Puck', label: 'Hindi (हिन्दी)' }, 
    'es-US': { name: 'Fenrir', label: 'Spanish (Español)' },
    'fr-FR': { name: 'Kore', label: 'French (Français)' }
};

// --- Utility Functions ---
const base64ToArrayBuffer = (base64) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
};

const pcmToWav = (pcm16, sampleRate) => {
    const numChannels = 1;
    const bytesPerSample = 2;
    const buffer = new ArrayBuffer(44 + pcm16.byteLength);
    const view = new DataView(buffer);

    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcm16.byteLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(view, 36, 'data');
    view.setUint32(40, pcm16.byteLength, true);

    const dataOffset = 44;
    for (let i = 0; i < pcm16.length; i++) {
        view.setInt16(dataOffset + i * 2, pcm16[i], true);
    }

    return new Blob([view], { type: 'audio/wav' });
};

// --- API Helper ---
const fetchWithRetry = async (url, payload, retries = 0) => {
    const delay = 2 ** retries * 1000;
    
    if (!GEMINI_API_KEY) throw new Error("Missing API Key.");

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.json();
            if ((response.status === 429 || response.status === 503) && retries < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, delay));
                return fetchWithRetry(url, payload, retries + 1);
            }
            throw new Error(`API Error ${response.status}: ${errorBody.error?.message || response.statusText}`);
        }
        return response.json();
    } catch (error) {
        if (retries < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(url, payload, retries + 1);
        }
        throw new Error(`Failed after ${MAX_RETRIES} attempts: ${error.message}`);
    }
};

// --- Main App Component ---

const App = () => {
    const [selectedImage, setSelectedImage] = useState(null);
    const [base64Image, setBase64Image] = useState(null);
    const [prediction, setPrediction] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [useCamera, setUseCamera] = useState(false);
    const [selectedLanguageCode, setSelectedLanguageCode] = useState('en-US');
    const [isAudioGenerating, setIsAudioGenerating] = useState(false);
    const [isAudioPlaying, setIsAudioPlaying] = useState(false);

    // Refs
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const fileInputRef = useRef(null);
    const audioRef = useRef(null);
    const streamRef = useRef(null);

    // --- Camera Control ---
    const stopCamera = useCallback(() => {
        setUseCamera(false); 
        streamRef.current = null;
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
    }, []);

    useEffect(() => {
        const video = videoRef.current;
        if (useCamera) {
            const streamCamera = async () => {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ 
                        video: { facingMode: 'environment' } 
                    });
                    
                    streamRef.current = stream;
                    if (video) {
                        video.srcObject = stream;
                        video.play().catch(err => console.warn("Video playback warning:", err));
                    }
                } catch (err) {
                    console.error("Camera access denied or failed:", err);
                    setError("Failed to access camera. Check permissions.");
                    setUseCamera(false);
                }
            };
            streamCamera();
        } else if (video?.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
        }

        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, [useCamera]);

    const startCamera = () => {
        clearAll();
        setUseCamera(true);
    };

    const capturePhoto = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        
        if (!video || !canvas || !streamRef.current) {
            setError("Video stream not ready.");
            return;
        }
        
        canvas.width = video.videoWidth || video.offsetWidth;
        canvas.height = video.videoHeight || video.offsetHeight;
        
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height); 

        canvas.toBlob(blob => {
            setSelectedImage(blob);
            stopCamera();
            
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result.split(',')[1];
                setBase64Image(base64String);
                analyzeWaste(base64String, selectedLanguageCode);
            };
            reader.readAsDataURL(blob);

        }, "image/jpeg");
    };

    // --- Handlers ---
    const clearAll = useCallback(() => {
        setSelectedImage(null);
        setBase64Image(null);
        setPrediction(null);
        setError(null);
        setIsLoading(false);
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }
        stopCamera();
    }, [stopCamera]);

    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (file && file.type.startsWith("image/")) {
            setSelectedImage(file);
            setError(null);
            
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result.split(',')[1];
                setBase64Image(base64String);
                analyzeWaste(base64String, selectedLanguageCode);
            };
            reader.readAsDataURL(file);
        } else {
            setError("Please upload a valid image file.");
        }
    };

    const updateLanguage = (e) => {
        const newLanguageCode = e.target.value;
        setSelectedLanguageCode(newLanguageCode);
        if (base64Image) {
            analyzeWaste(base64Image, newLanguageCode);
        }
    };

    // --- Gemini Analysis Logic ---
    const classifyWaste = useCallback(async (base64, languageCode) => {
        const voiceConfig = VOICE_CONFIGS[languageCode];
        const languageLabel = voiceConfig.label.split(' ')[0]; 

        const userPrompt = `You are a specialized waste-to-wealth classifier. Analyze the provided image of a waste item. Determine the common name of the object (e.g., Plastic Bottle, Cardboard Box), its primary material (e.g., Plastic, Paper, Metal), estimate a simple monetary value in USD (as a number, e.g., 0.02, based on typical recycling commodity prices), and include the approximate weight in kilograms (as a number, e.g., 0.5) that this value corresponds to. Provide clear, concise, disposal instructions for a ragpicker/user. IMPORTANT: Provide the disposal instructions IN ${languageLabel}.`;

        const payload = {
            contents: [{
                role: "user",
                parts: [
                    { text: userPrompt },
                    { inlineData: { mimeType: "image/jpeg", data: base64 } }
                ]
            }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        "objectName": { "type": "STRING" },
                        "material": { "type": "STRING" },
                        "estimatedValueUSD": { "type": "NUMBER" },
                        "estimatedWeightKg": { "type": "NUMBER" },
                        "disposalInstructions": { "type": "STRING" }
                    },
                    "required": ["objectName", "material", "estimatedValueUSD", "estimatedWeightKg", "disposalInstructions"]
                }
            }
        };

        const response = await fetchWithRetry(API_URL, payload);
        const candidate = response.candidates?.[0];

        if (candidate && candidate.content?.parts?.[0]?.text) {
            try {
                return JSON.parse(candidate.content.parts[0].text);
            } catch (e) {
                throw new Error("Could not interpret AI classification data.");
            }
        }
        throw new Error("AI classification failed to return content.");
    }, []);

    const analyzeWaste = async (base64, languageCode) => {
        if (!base64) return setError("Image data missing. Please capture or upload an image.");
        setIsLoading(true);
        setError(null);
        setPrediction(null);

        try {
            const result = await classifyWaste(base64, languageCode);
            const estimatedValueINR = Math.round((result.estimatedValueUSD || 0) * INR_PER_USD * 100) / 100;
            const estimatedWeightKg = result.estimatedWeightKg || 0;

            setPrediction({
                objectName: result.objectName,
                category: result.material,
                valueINR: estimatedValueINR.toFixed(2),
                weightKg: estimatedWeightKg,
                message: result.disposalInstructions,
            });

        } catch (err) {
            console.error(err);
            setError(err.message || "Failed to analyze image.");
        } finally {
            setIsLoading(false);
        }
    };

    // --- TTS Audio Logic (Fixed for Gemini 2.0) ---
    const generateAndPlayAudio = useCallback(async (text) => {
        if (!text) return setError("No instructions to play.");
        if (isAudioPlaying && audioRef.current) {
            audioRef.current.pause();
            return; 
        }

        setIsAudioGenerating(true);
        setIsAudioPlaying(false);
        if (audioRef.current) audioRef.current.pause();

        try {
            const voiceConfig = VOICE_CONFIGS[selectedLanguageCode];
            const payload = {
                contents: [{ parts: [{ text: text }] }],
                generationConfig: {
                    responseModalities: ["AUDIO"], // This requires gemini-2.0-flash-exp
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceConfig.name } }
                    }
                }
            };

            const response = await fetchWithRetry(API_URL, payload);
            const part = response?.candidates?.[0]?.content?.parts?.[0];
            const audioData = part?.inlineData?.data;
            
            // Gemini 2.0 returns raw audio, sometimes without specific mimeType in the struct
            // but we know it returns base64 PCM 24kHz usually.
            if (audioData) {
                const sampleRate = 24000; // Gemini 2.0 Flash Exp Standard
                const pcmDataBuffer = base64ToArrayBuffer(audioData);
                const pcm16 = new Int16Array(pcmDataBuffer);
                const wavBlob = pcmToWav(pcm16, sampleRate);
                const audioUrl = URL.createObjectURL(wavBlob);
                
                audioRef.current = new Audio(audioUrl);
                audioRef.current.onended = () => setIsAudioPlaying(false);
                audioRef.current.onpause = () => setIsAudioPlaying(false); 

                setIsAudioGenerating(false);
                setIsAudioPlaying(true);
                audioRef.current.play();
            } else {
                throw new Error("API failed to return audio data.");
            }

        } catch (error) {
            console.error("TTS Error:", error);
            setError("Voice generation unavailable. " + error.message);
        } finally {
            setIsAudioGenerating(false);
        }
    }, [selectedLanguageCode, isAudioPlaying]);

    // --- Components ---

    const renderPredictionBox = () => {
        if (!prediction) return null;
        
        const isRecyclable = prediction.category?.toLowerCase().match(/plastic|paper|metal|glass|cardboard/);
        const message = prediction.message;

        const weightValue = parseFloat(prediction.weightKg || 0);
        let displayWeight = weightValue === 0 
            ? "None detectable" 
            : (weightValue < 0.1 ? `${(weightValue * 1000).toFixed(0)}g` : `${weightValue.toFixed(2)} kg`);
        
        const handleAudioButtonClick = () => {
            if (isAudioPlaying && audioRef.current) {
                audioRef.current.pause();
            } else {
                generateAndPlayAudio(message);
            }
        };

        return (
            <motion.div 
                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="w-full glass-card rounded-2xl p-6 mt-6 text-left relative overflow-hidden group"
            >
                {/* Decorative background glow */}
                <div className={`absolute top-0 right-0 w-32 h-32 blur-3xl rounded-full opacity-20 -mr-10 -mt-10 ${isRecyclable ? 'bg-green-500' : 'bg-yellow-500'}`}></div>

                {/* Header Section */}
                <div className="flex justify-between items-start mb-6 relative z-10">
                    <div>
                        <motion.div 
                            initial={{ x: -20, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            className="flex items-center gap-2 mb-1"
                        >
                            {isRecyclable ? <Recycle className="text-emerald-600" size={24}/> : <Leaf className="text-yellow-600" size={24}/>}
                            <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-full ${isRecyclable ? 'bg-emerald-100 text-emerald-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                {prediction.category}
                            </span>
                        </motion.div>
                        <h2 className="text-2xl font-bold text-gray-800 leading-tight">
                            {prediction.objectName}
                        </h2>
                    </div>
                    
                    <div className="text-right">
                        <motion.div 
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: 0.2, type: "spring" }}
                            className="bg-white/50 px-4 py-2 rounded-xl border border-white/60 shadow-sm"
                        >
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Value</p>
                            <p className="text-3xl font-extrabold text-emerald-600">₹{prediction.valueINR}</p>
                        </motion.div>
                        <p className="text-xs text-gray-500 mt-1 font-medium">{displayWeight}</p>
                    </div>
                </div>

                {/* Language & Voice Section */}
                <div className="space-y-4 relative z-10">
                    <div className="bg-white/40 p-1 rounded-lg flex items-center border border-white/50">
                        <div className="p-2 bg-white rounded-md shadow-sm">
                            <Mic size={16} className="text-indigo-500" />
                        </div>
                        <select 
                            id="language-select" 
                            value={selectedLanguageCode} 
                            onChange={updateLanguage}
                            className="w-full bg-transparent border-none text-sm font-medium text-gray-700 focus:ring-0 cursor-pointer pl-3"
                        >
                            {Object.entries(VOICE_CONFIGS).map(([code, config]) => (
                                <option key={code} value={code}>{config.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="bg-white/60 rounded-xl p-4 border border-white/50 shadow-inner">
                        <h4 className="font-semibold text-gray-800 flex items-center gap-2 mb-2 text-sm">
                            <Zap size={16} className="text-amber-500 fill-amber-500" /> 
                            Smart Disposal Guide
                        </h4>
                        <p className="text-gray-700 text-sm leading-relaxed">{message}</p>
                    </div>

                    <motion.button
                        whileHover={{ scale: 1.02, boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)" }}
                        whileTap={{ scale: 0.98 }}
                        onClick={handleAudioButtonClick}
                        disabled={isAudioGenerating || !message}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl font-bold text-white shadow-lg transition-all ${
                            isAudioPlaying 
                            ? 'bg-rose-500 hover:bg-rose-600' 
                            : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700'
                        }`}
                    >
                        {isAudioPlaying ? <PauseCircle size={20} /> : <PlayCircle size={20} />}
                        {isAudioPlaying ? 'Stop Instructions' : (isAudioGenerating ? 'Generating Voice...' : 'Read Aloud')}
                    </motion.button>
                </div>
            </motion.div>
        );
    };

    return (
        <div className="min-h-screen animated-bg flex flex-col items-center justify-center p-4 md:p-6">
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="glass-panel rounded-3xl p-6 md:p-8 w-full max-w-lg text-center relative overflow-visible"
            >
                {/* 3D Floating Header Icon */}
                <motion.div 
                    animate={{ y: [0, -10, 0] }}
                    transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                    className="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-white p-4 rounded-2xl shadow-xl border border-emerald-100"
                >
                    <Recycle size={40} className="text-emerald-500" />
                </motion.div>

                <div className="mt-8 mb-6">
                    <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-800 tracking-tight">
                        Swachh<span className="font-light">AI</span>
                    </h1>
                    <p className="text-slate-500 text-sm mt-2 font-medium">Identify waste, estimate value, and recycle smarter.</p>
                </div>

                <div className="flex flex-col items-center gap-5">
                    {/* Camera or Image Preview */}
                    <AnimatePresence mode="wait">
                        {useCamera && (
                            <motion.div 
                                key="camera"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className="w-full relative"
                            >
                                <div className="relative w-full aspect-video min-h-[250px] bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border-4 border-white/50">
                                    <video 
                                        ref={videoRef} 
                                        autoPlay 
                                        playsInline 
                                        className="w-full h-full object-cover"
                                    ></video>
                                    <motion.div 
                                        animate={{ top: ["0%", "100%", "0%"] }}
                                        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                                        className="absolute left-0 w-full h-0.5 bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.8)] z-10"
                                    />
                                    <div className="absolute top-4 right-4 bg-black/50 px-3 py-1 rounded-full text-white text-xs backdrop-blur-sm flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div> LIVE
                                    </div>
                                </div>
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={capturePhoto}
                                    className="mt-4 w-full bg-white text-emerald-700 border-2 border-emerald-100 hover:border-emerald-300 px-5 py-3 rounded-xl shadow-lg transition font-bold flex items-center justify-center gap-2"
                                    disabled={isLoading}
                                >
                                    <ScanLine size={20} /> Capture & Analyze
                                </motion.button>
                            </motion.div>
                        )}

                        {selectedImage && !useCamera && (
                            <motion.div 
                                key="preview"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="w-full"
                            >
                                <div className="relative rounded-2xl overflow-hidden shadow-lg border-4 border-white">
                                    <img
                                        src={URL.createObjectURL(selectedImage)}
                                        alt="Preview"
                                        className="w-full max-h-72 object-cover"
                                    />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    
                    <canvas ref={canvasRef} className="hidden" />

                    <div className="flex flex-wrap justify-center gap-3 w-full">
                        {!selectedImage && !useCamera && (
                            <>
                                <input
                                    type="file"
                                    accept="image/*"
                                    ref={fileInputRef}
                                    className="hidden"
                                    onChange={handleFileChange}
                                />
                                <motion.button
                                    whileHover={{ y: -2 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex-1 min-w-[45%] flex flex-col items-center justify-center gap-2 bg-white/60 hover:bg-white/90 border border-white/50 text-slate-700 px-4 py-6 rounded-2xl shadow-sm transition group"
                                >
                                    <div className="bg-blue-100 p-3 rounded-full text-blue-600 group-hover:scale-110 transition-transform">
                                        <Upload size={24} />
                                    </div>
                                    <span className="font-semibold text-sm">Upload Photo</span>
                                </motion.button>

                                <motion.button
                                    whileHover={{ y: -2 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={startCamera}
                                    className="flex-1 min-w-[45%] flex flex-col items-center justify-center gap-2 bg-white/60 hover:bg-white/90 border border-white/50 text-slate-700 px-4 py-6 rounded-2xl shadow-sm transition group"
                                >
                                    <div className="bg-emerald-100 p-3 rounded-full text-emerald-600 group-hover:scale-110 transition-transform">
                                        <Camera size={24} />
                                    </div>
                                    <span className="font-semibold text-sm">Live Camera</span>
                                </motion.button>
                            </>
                        )}

                        {selectedImage && !useCamera && !prediction && (
                             <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => analyzeWaste(base64Image, selectedLanguageCode)}
                                disabled={isLoading}
                                className="w-full flex items-center justify-center gap-3 bg-slate-800 hover:bg-slate-900 text-white px-6 py-4 rounded-xl shadow-xl transition-all disabled:opacity-70 font-bold text-lg"
                            >
                                {isLoading ? <Loader2 size={24} className="animate-spin" /> : <ImageIcon size={24} />}
                                {isLoading ? "Processing..." : "Identify Object"}
                            </motion.button>
                        )}

                        {(selectedImage || useCamera) && (
                            <motion.button
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                onClick={clearAll}
                                className="text-slate-400 hover:text-red-500 text-sm font-medium flex items-center gap-1 py-2 px-4 transition-colors"
                            >
                                <Trash2 size={16} /> Reset
                            </motion.button>
                        )}
                    </div>

                    {isLoading && (
                        <motion.div 
                            initial={{ opacity: 0 }} 
                            animate={{ opacity: 1 }}
                            className="flex flex-col items-center gap-2 text-emerald-600 font-medium bg-white/80 px-6 py-3 rounded-full shadow-sm"
                        >
                            <Loader2 size={24} className="animate-spin" />
                            <span className="text-sm">Analyzing composition...</span>
                        </motion.div>
                    )}
                </div>

                <AnimatePresence>
                    {error && (
                        <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="mt-4 text-red-600 text-sm font-medium p-3 bg-red-50/80 border border-red-200 rounded-xl backdrop-blur-sm"
                        >
                            {error}
                        </motion.div>
                    )}
                </AnimatePresence>

                {renderPredictionBox()}
            </motion.div>
        </div>
    );
};

export default App;