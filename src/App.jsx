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
    PauseCircle
} from 'lucide-react';

// --- Constants ---
// IMPORTANT: If running this locally, you MUST replace the key below.
const GEMINI_API_KEY = "AIzaSyDGb9DuWMEeOgCdf7Yz6yElj-Hr8WTLOBc"; 

const INR_PER_USD = 83; // Exchange rate for INR value calculation
const API_URL_GEMINI = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
const API_URL_TTS = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_API_KEY}`;
const MAX_RETRIES = 5;
const VOICE_CONFIGS = {
    'en-US': { name: 'Kore', label: 'English (US)' },
    'hi-IN': { name: 'Achird', label: 'Hindi (हिन्दी)' },
    'es-US': { name: 'Callirrhoe', label: 'Spanish (Español)' },
    'fr-FR': { name: 'Umbriel', label: 'French (Français)' }
};

// --- Utility Functions (for TTS audio playback) ---

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

// --- API Helper Function (with retry logic) ---

const fetchWithRetry = async (url, payload, retries = 0) => {
    const delay = 2 ** retries * 1000;
    
    if (!GEMINI_API_KEY && url.includes('key=')) {
        throw new Error("Missing API Key. Please update the GEMINI_API_KEY constant in the code.");
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.json();
            if (response.status === 429 && retries < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, delay));
                return fetchWithRetry(url, payload, retries + 1);
            }
            throw new Error(`API Error ${response.status}: ${errorBody.error?.message || 'Unknown error'}`);
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
    const [selectedImage, setSelectedImage] = useState(null); // Blob or File object
    const [base64Image, setBase64Image] = useState(null); // Base64 string for API calls
    const [prediction, setPrediction] = useState(null); // Full result object
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

    // Simplified stopCamera to work with the useEffect lifecycle
    const stopCamera = useCallback(() => {
        // Only responsible for setting the state; useEffect handles stream cleanup
        setUseCamera(false); 
        streamRef.current = null;
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
    }, []);

    // Effect to handle camera lifecycle (Start/Stop) based on useCamera state
    useEffect(() => {
        const video = videoRef.current;
        if (useCamera) {
            const streamCamera = async () => {
                try {
                    // Use 'user' for front camera (common on laptops)
                    const stream = await navigator.mediaDevices.getUserMedia({ 
                        video: { facingMode: 'user' } 
                    });
                    
                    streamRef.current = stream;
                    if (video) {
                        video.srcObject = stream;
                        // Attempt to play, essential for some browsers
                        video.play().catch(err => {
                            console.warn("Video playback warning:", err);
                        });
                    }
                } catch (err) {
                    console.error("Camera access denied or failed:", err);
                    setError(err.name === "NotAllowedError" 
                        ? "Camera access was denied. Please allow it in browser settings."
                        : "Failed to access camera. Check device connection."
                    );
                    setUseCamera(false); // Stop camera if fails
                }
            };
            streamCamera();
        } else if (video?.srcObject) {
            // Cleanup stream when useCamera becomes false
            video.srcObject.getTracks().forEach(track => track.stop());
        }

        return () => {
            // Cleanup on component unmount
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, [useCamera]);

    // Simple function to initiate camera mode
    const startCamera = () => {
        clearAll();
        setUseCamera(true); // Triggers the useEffect hook
    };

    // 📷 Capture photo - Converts to Base64 and starts analysis
    const capturePhoto = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        
        if (!video || !canvas || !streamRef.current) {
            setError("Video stream not ready. Please wait or try restarting the camera.");
            return;
        }
        
        // Ensure canvas dimensions are correct
        canvas.width = video.videoWidth || video.offsetWidth;
        canvas.height = video.videoHeight || video.offsetHeight;
        
        const ctx = canvas.getContext("2d");
        
        // Draw image, flipping horizontally to undo CSS flip
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, -canvas.width, canvas.height); 
        ctx.restore();

        // Convert canvas to Blob (for selectedImage state) and Base64 (for API)
        canvas.toBlob(blob => {
            setSelectedImage(blob);
            stopCamera(); // Stop camera and set useCamera=false 
            
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
            
            // Convert to Base64 for API call
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

        // Re-analyze using the stored image (if available) with the new language
        if (base64Image) {
            analyzeWaste(base64Image, newLanguageCode);
        }
    };


    // --- Gemini Analysis Logic ---

    const classifyWaste = useCallback(async (base64, languageCode) => {
        const voiceConfig = VOICE_CONFIGS[languageCode];
        const languageLabel = voiceConfig.label.split(' ')[0]; 

        // UPDATED PROMPT: Now requesting the common name of the object
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
                // UPDATED SCHEMA: Added estimatedWeightKg
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        "objectName": { "type": "STRING", "description": "The common name of the object." }, // NEW PROPERTY
                        "material": { "type": "STRING", "description": "Primary material classification." },
                        "estimatedValueUSD": { "type": "NUMBER", "description": "Estimated value of the recyclable material in USD." },
                        "estimatedWeightKg": { "type": "NUMBER", "description": "Estimated weight in kilograms." },
                        "disposalInstructions": { "type": "STRING", "description": "Clear, voice-friendly instructions." }
                    },
                    "required": ["objectName", "material", "estimatedValueUSD", "estimatedWeightKg", "disposalInstructions"] // UPDATED REQUIRED
                }
            }
        };

        const response = await fetchWithRetry(API_URL_GEMINI, payload);
        const candidate = response.candidates?.[0];

        if (candidate && candidate.content?.parts?.[0]?.text) {
            const jsonText = candidate.content.parts[0].text;
            try {
                return JSON.parse(jsonText);
            } catch (e) {
                throw new Error("Could not interpret AI classification data.");
            }
        }
        throw new Error("AI classification failed to return content.");
    }, []);


    // *** Replaced the old analyzeWaste (which called the local server) ***
    const analyzeWaste = async (base64, languageCode) => {
        if (!base64) return setError("Image data missing. Please capture or upload an image.");

        setIsLoading(true);
        setError(null);
        setPrediction(null);

        try {
            const result = await classifyWaste(base64, languageCode);
            
            // Calculate INR value, allowing it to be 0 if USD value is 0 or null.
            const estimatedValueINR = Math.round((result.estimatedValueUSD || 0) * INR_PER_USD * 100) / 100;
            
            // Extract estimated weight, allowing it to be 0 if Kg value is 0 or null.
            const estimatedWeightKg = result.estimatedWeightKg || 0;

            // Update prediction state with new object name and weight
            setPrediction({
                objectName: result.objectName, // NEW
                category: result.material,
                valueINR: estimatedValueINR.toFixed(2),
                weightKg: estimatedWeightKg,
                message: result.disposalInstructions,
            });

        } catch (err) {
            console.error(err);
            setError(err.message || "Failed to analyze image using Gemini API. Check your API key or network.");
        } finally {
            setIsLoading(false);
        }
    };


    // --- TTS Audio Logic ---

    const generateAndPlayAudio = useCallback(async (text) => {
        if (!text) return setError("No instructions to play.");

        // If audio is already playing, pause it and exit (handles rapid clicks)
        if (isAudioPlaying && audioRef.current) {
            audioRef.current.pause();
            return; 
        }

        setIsAudioGenerating(true);
        setIsAudioPlaying(false);
        if (audioRef.current) audioRef.current.pause(); // Stop any existing audio

        try {
            const voiceConfig = VOICE_CONFIGS[selectedLanguageCode];
            const payload = {
                contents: [{ parts: [{ text: text }] }],
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceConfig.name } }
                    }
                },
                model: "gemini-2.5-flash-preview-tts"
            };

            const response = await fetchWithRetry(API_URL_TTS, payload);
            const part = response?.candidates?.[0]?.content?.parts?.[0];
            const audioData = part?.inlineData?.data;
            const mimeType = part?.inlineData?.mimeType;

            if (audioData && mimeType && mimeType.startsWith("audio/")) {
                const match = mimeType.match(/rate=(\d+)/);
                if (!match) throw new Error("Sample rate information missing from TTS mimeType.");
                
                const sampleRate = parseInt(match[1], 10);
                const pcmDataBuffer = base64ToArrayBuffer(audioData);
                const pcm16 = new Int16Array(pcmDataBuffer);
                const wavBlob = pcmToWav(pcm16, sampleRate);
                const audioUrl = URL.createObjectURL(wavBlob);
                
                audioRef.current = new Audio(audioUrl);
                
                // Listener for natural end of playback
                audioRef.current.onended = () => setIsAudioPlaying(false);
                
                // FIX: Listener for manual pause/stop (ensures state updates when button is clicked)
                audioRef.current.onpause = () => setIsAudioPlaying(false); 

                setIsAudioGenerating(false);
                setIsAudioPlaying(true);
                audioRef.current.play().catch(e => {
                    console.error("Audio playback failed:", e);
                    setError("Playback failed. Ensure your browser is not blocking media autoplay.");
                    setIsAudioPlaying(false);
                });
            } else {
                throw new Error("TTS API failed to return audio data.");
            }

        } catch (error) {
            console.error("TTS Error:", error);
            setError(error.message || "Could not generate voice instructions.");
        } finally {
            setIsAudioGenerating(false);
        }
    }, [selectedLanguageCode, isAudioPlaying]); // Dependency updated to include isAudioPlaying

    // 💬 Render prediction box
    const renderPredictionBox = () => {
        if (!prediction) return null;
        
        const isRecyclable = prediction.category?.toLowerCase() !== "non-recyclable"; 
        
        const bgColor = isRecyclable ? "bg-green-100 border-green-500" : "bg-yellow-100 border-yellow-500";
        const iconColor = isRecyclable ? "text-green-600" : "text-yellow-600";
        const mainIcon = isRecyclable ? <Recycle size={28} className={iconColor} /> : <Leaf size={28} className={iconColor} />;
        
        const message = prediction.message;

        const playText = isAudioPlaying ? 'Stop Audio' : (isAudioGenerating ? 'Generating...' : 'Play Voice');
        const playIcon = isAudioPlaying ? <PauseCircle size={18} /> : <PlayCircle size={18} />;

        // LOGIC: Determine how to display the weight (grams or kg)
        const weightValue = parseFloat(prediction.weightKg || 0);
        let displayWeight;
        if (weightValue === 0) {
            displayWeight = "None detectable"; // Explicitly handle zero weight
        } else if (weightValue > 0 && weightValue < 0.1) { // Less than 100g, show in grams
            displayWeight = `${(weightValue * 1000).toFixed(0)} grams`;
        } else { // >= 0.1 kg
            displayWeight = `${weightValue.toFixed(2)} kg`;
        }
        
        // Conditional button click handler to manage pause/play
        const handleAudioButtonClick = () => {
            if (isAudioPlaying && audioRef.current) {
                audioRef.current.pause();
            } else {
                generateAndPlayAudio(message);
            }
        };


        return (
            <div className={`border-2 rounded-xl p-5 mt-6 text-left shadow-lg ${bgColor}`}>
                {/* Value and Category */}
                <div className="flex justify-between items-center mb-4 border-b pb-3">
                    <hgroup className="text-left">
                        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2 mb-1">
                            {mainIcon}
                            {prediction.objectName} {/* Display Object Name */}
                        </h2>
                        <h3 className="text-sm font-semibold text-gray-600 ml-8">
                            Material: {prediction.category} {/* Display Material Category */}
                        </h3>
                    </hgroup>
                    <div className="text-right">
                        <p className="text-sm font-medium text-green-700">Estimated Value:</p>
                        <p className="text-2xl font-bold text-green-700">₹{prediction.valueINR}</p>
                        {/* NEW: Display weight corresponding to value */}
                        <p className="text-xs text-gray-500 mt-1">
                            (for approx. <span className="font-semibold text-gray-700">{displayWeight}</span>)
                        </p>
                    </div>
                </div>

                {/* Language Selector */}
                <div className="mb-4">
                    <label htmlFor="language-select" className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                        <Mic size={16} className="mr-1" />
                        Language for Voice Instructions:
                    </label>
                    <select 
                        id="language-select" 
                        value={selectedLanguageCode} 
                        onChange={updateLanguage}
                        className="w-full py-2 px-3 border border-gray-300 bg-white rounded-lg shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 text-sm"
                    >
                        {Object.entries(VOICE_CONFIGS).map(([code, config]) => (
                            <option key={code} value={code}>{config.label}</option>
                        ))}
                    </select>
                </div>
                
                {/* Instructions and Play Button */}
                <h4 className="font-semibold text-gray-800 flex items-center gap-1 mb-2">
                    <Zap size={16} /> Disposal Guidance:
                </h4>
                <p className="text-gray-700 text-sm italic border-l-4 border-gray-400 pl-3 py-1 mb-4">{message}</p>
                
                <button
                    onClick={handleAudioButtonClick}
                    disabled={isAudioGenerating || !message}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl transition duration-300 disabled:opacity-50 font-semibold ${!isAudioPlaying ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-red-500 hover:bg-red-600 text-white'}`}
                >
                    {playIcon}
                    {playText}
                </button>
            </div>
        );
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
            <div className="bg-white shadow-2xl rounded-2xl p-6 w-full max-w-lg text-center border border-green-200">
                <h1 className="text-3xl font-bold mb-2 flex justify-center items-center gap-2">
                    <Recycle size={30} className="text-green-600" />
                    Swachh<span className="text-green-600">AI</span>
                </h1>
                <p className="text-gray-600 mb-6 text-sm">Waste-to-Wealth: Classify, get value in ₹, and receive voice instructions.</p>

                <div className="flex flex-col items-center gap-4">
                    {/* Camera or Image Preview */}
                    {useCamera && (
                        <div className="mt-4 w-full">
                            <div className="relative w-full aspect-video min-h-[250px] bg-gray-800 rounded-xl overflow-hidden shadow-xl flex items-center justify-center">
                                <video 
                                    ref={videoRef} 
                                    autoPlay 
                                    playsInline 
                                    className="rounded-xl border border-gray-300 w-full max-w-sm"
                                ></video>
                            </div>
                            <button
                                onClick={capturePhoto}
                                className="mt-4 w-full bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl shadow-md transition flex items-center justify-center gap-2 font-semibold"
                                disabled={isLoading}
                            >
                                <Camera size={20} /> Take Snapshot & Analyze
                            </button>
                        </div>
                    )}

                    {selectedImage && !useCamera && (
                        <div className="mt-4">
                            <img
                                src={URL.createObjectURL(selectedImage)}
                                alt="Preview"
                                className="rounded-xl shadow-md max-h-64 object-contain w-full"
                            />
                        </div>
                    )}
                    
                    {/* Hidden Canvas for capture */}
                    <canvas ref={canvasRef} className="hidden" />

                    {/* Action Buttons */}
                    <div className="flex flex-wrap justify-center gap-3 w-full mt-4">
                        {!selectedImage && !useCamera && (
                            <>
                                {/* Upload Button */}
                                <input
                                    type="file"
                                    accept="image/*"
                                    ref={fileInputRef}
                                    className="hidden"
                                    onChange={handleFileChange}
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex-1 min-w-[45%] items-center justify-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2.5 rounded-xl shadow-md transition font-semibold"
                                >
                                    <Upload size={18} /> Upload Image
                                </button>
                                {/* Camera Button */}
                                <button
                                    onClick={startCamera}
                                    className="flex-1 min-w-[45%] items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2.5 rounded-xl shadow-md transition font-semibold"
                                >
                                    <Camera size={18} /> Open Live Camera
                                </button>
                            </>
                        )}
                        {/* The Analyze button is now only shown if an image is selected and we are NOT in camera mode */}
                        {selectedImage && !useCamera && !prediction && (
                             <button
                                onClick={() => analyzeWaste(base64Image, selectedLanguageCode)}
                                disabled={isLoading}
                                className="w-full mt-2 flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl shadow-md transition disabled:opacity-70 font-semibold"
                            >
                                {isLoading ? <Loader2 size={20} className="animate-spin" /> : <ImageIcon size={20} />}
                                {isLoading ? "Analyzing..." : "Analyze Image"}
                            </button>
                        )}

                        {(selectedImage || useCamera) && (
                            <button
                                onClick={clearAll}
                                className="w-full flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2.5 rounded-xl shadow-md transition font-semibold"
                            >
                                <Trash2 size={18} /> Clear / Start Over
                            </button>
                        )}
                    </div>

                    {/* Loading Indicator */}
                    {isLoading && (
                        <div className="mt-4 flex items-center justify-center gap-2 text-green-600 font-medium">
                            <Loader2 size={20} className="animate-spin" />
                            Analyzing waste item...
                        </div>
                    )}
                </div>

                {/* Error Message */}
                {error && <p className="mt-4 text-red-500 font-medium p-3 bg-red-50 border border-red-300 rounded-lg">{error}</p>}

                {/* Prediction Message (Includes Language and Audio) */}
                {renderPredictionBox()}
            </div>
        </div>
    );
};

export default App;
