"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  MessageSquare,
  Send,
  Paperclip,
  X,
} from "lucide-react";

// --- KIE API CONFIG ---
const KIE_API = "https://api.kie.ai/api/v1/gpt4o-image/record-info";
const KIE_TOKEN = "9c864c5ce4567f00a4f21536abffabc3";
const AD_WEBHOOK_URL = "https://vidgy.app.n8n.cloud/webhook/dfc4bb03-133f-4413-8f87-d6746addcf06";
const GOOGLE_SHEET_ID = "133ZHExWO_6Jfdmx_VRntJG_XJuy7wTXgepPs78yRuyg";
const PROMPTS = [
  "Generate a modern smart touch panel UI design.",
  "Show me a luxury home automation setup.",
  "Create images of futuristic urban living spaces.",
  "Design a minimalist touch switch interface.",
  "Visualize smart home convenience features.",
  "Illustrate a smart panel replacing traditional switches.",
  "Concept art for a high-tech smart home control panel.",
  "Render a user-friendly smart touch panel layout.",
];

// --- UTILS ---
function cn(...args) {
  return args.filter(Boolean).join(" ");
}

function parseCSV(csvText) {
  const lines = csvText.split('\n');
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const row = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    row.push(current.trim());
    result.push(row);
  }
  return { data: result };
}

async function fetchKieImage(taskId) {
  if (!taskId) return [];
  try {
    const resp = await fetch(
      `${KIE_API}?taskId=${encodeURIComponent(taskId)}`,
      {
        headers: { Authorization: `Bearer ${KIE_TOKEN}` },
      }
    );
    if (!resp.ok) {
      console.error("Failed to fetch KIE image:", resp.status, resp.statusText);
      return [];
    }
    const data = await resp.json();
    const urls = data?.data?.response?.resultUrls || data?.resultUrls || [];
    console.log("Fetched KIE image URLs:", urls);
    return urls;
  } catch (error) {
    console.error("Error fetching KIE image:", error);
    return [];
  }
}

async function getAllImagesForTaskIds(taskIds) {
  if (!taskIds || taskIds.length === 0) return [];
  console.log("Fetching images for task IDs:", taskIds);
  const results = await Promise.all(
    taskIds.map(taskId => fetchKieImage(taskId))
  );
  const flattened = results.flat();
  console.log("All fetched images:", flattened);
  return flattened;
}

// --- MAIN COMPONENT ---
export default function App() {
  const [placeholderText, setPlaceholderText] = useState("");
  const [promptIndex, setPromptIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [sheetConversations, setSheetConversations] = useState([]);
  const [threads, setThreads] = useState([]);
  const [selectedThread, setSelectedThread] = useState("excel-new-1");
  const [inputText, setInputText] = useState("");
  const [uploadedImages, setUploadedImages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingSheetData, setIsLoadingSheetData] = useState(true);
  const [selectedImageIndex, setSelectedImageIndex] = useState(null);
  const [imageLoadErrors, setImageLoadErrors] = useState({});

  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const chatAreaRef = useRef(null);

  // --- SHEET LOADER ---
  const fetchGoogleSheetData = useCallback(async () => {
    try {
      setIsLoadingSheetData(true);
      const csvUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv&gid=2100534081`;
      const response = await fetch(csvUrl, { method: "GET", headers: { Accept: "text/csv" } });
      if (!response.ok) throw new Error(`Failed to fetch sheet data: ${response.status}`);
      const csvText = await response.text();
      const { data: rows } = parseCSV(csvText);
      const header = rows[0];
      const conversations = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 3) continue;
        const prompt = row[0]?.trim() || "";
        let outputShotList = "";
        let imageLinksRaw = "";
        header.forEach((h, idx) => {
          if (h.toLowerCase().includes("output shot")) outputShotList = row[idx]?.trim() || "";
          if (h.toLowerCase().includes("image task id")) imageLinksRaw = row[idx]?.trim() || "";
        });
        outputShotList = outputShotList || row[1]?.trim() || "";
        imageLinksRaw = imageLinksRaw || row[2]?.trim() || "";

        let shots = [];
        if (outputShotList) {
          try {
            let parsed = outputShotList;
            for (let tries = 0; tries < 2; tries++) {
              if (typeof parsed === "string") parsed = JSON.parse(parsed);
            }
            if (Array.isArray(parsed)) {
              shots = parsed.map((s, idx) => {
                if (typeof s === "object") {
                  return {
                    shot_number: Number(s.shot_number) || idx + 1,
                    shot_name: s.shot_name,
                    shot_description: s.shot_description,
                    description: s.description || s.shot_description || s.output || "",
                  };
                }
                if (typeof s === "string") {
                  try {
                    const maybeObj = JSON.parse(s);
                    return {
                      shot_number: maybeObj.shot_number || idx + 1,
                      shot_name: maybeObj.shot_name,
                      shot_description: maybeObj.shot_description,
                      description: maybeObj.description || maybeObj.shot_description || maybeObj.output || s,
                    };
                  } catch {
                    return {
                      shot_number: idx + 1,
                      description: s,
                    };
                  }
                }
                return null;
              }).filter(Boolean);
            }
          } catch {
            shots = [{
              shot_number: 1,
              description: outputShotList,
            }];
          }
        }

        let taskIds = [];
        if (imageLinksRaw) {
          try {
            let parsed = JSON.parse(imageLinksRaw);
            if (Array.isArray(parsed)) {
              taskIds = parsed.map((x) => typeof x === "string" ? x.trim() : x).filter(Boolean);
            } else if (typeof parsed === "string") {
              taskIds = [parsed.trim()];
            }
          } catch {
            if (imageLinksRaw.includes(",")) {
              taskIds = imageLinksRaw.split(",").map((x) => x.trim()).filter(Boolean);
            } else if (imageLinksRaw.length > 0) {
              taskIds = [imageLinksRaw.trim()];
            }
          }
        }

        conversations.push({ prompt, shots, taskIds });
      }
      setSheetConversations(conversations);
    } catch (error) {
      console.error("Error loading sheet data:", error);
      setSheetConversations([]);
    } finally {
      setIsLoadingSheetData(false);
    }
  }, []);

  // --- LOAD SHEET INITIALLY ---
  useEffect(() => {
    fetchGoogleSheetData();
  }, [fetchGoogleSheetData]);

  // --- BUILD THREADS FROM SHEET ---
  useEffect(() => {
    if (!isLoadingSheetData) {
      (async () => {
        const sheetThreads = [];
        for (let index = 0; index < sheetConversations.length; ++index) {
          const conv = sheetConversations[index];
          let galleryImages = [];
          if (conv.taskIds && conv.taskIds.length > 0) {
            galleryImages = await getAllImagesForTaskIds(conv.taskIds);
          }
          const threadId = `sheet-${index + 1}`;
          const userMessage = {
            id: `${threadId}-user`,
            text: conv.prompt,
            isUser: true,
            uploadedImages: [],
            timestamp: new Date(Date.now() - (sheetConversations.length - index) * 60000),
          };
          sheetThreads.push({
            id: threadId,
            title: conv.prompt.slice(0, 80),
            messages: [userMessage],
            createdAt: new Date(Date.now() - (sheetConversations.length - index) * 60000),
            isFrozen: true,
            galleryImages,
            galleryPrompt: conv.prompt || "",
            galleryTaskIds: conv.taskIds || [],
            shots: conv.shots || [],
          });
        }
        setThreads([
          {
            id: "excel-new-1",
            title: "New Chat",
            messages: [],
            createdAt: new Date(),
            isFrozen: false,
            galleryImages: [],
            galleryPrompt: "",
            galleryTaskIds: [],
            isNewChat: true,
            shots: [],
          },
          ...sheetThreads,
        ]);
      })();
    }
  }, [isLoadingSheetData, sheetConversations]);

  // --- PLACEHOLDER ANIMATION ---
  useEffect(() => {
    if (isGenerating) return;
    const currentPrompt = PROMPTS[promptIndex];
    if (charIndex < currentPrompt.length) {
      const timeout = setTimeout(() => {
        setPlaceholderText((prev) => prev + currentPrompt.charAt(charIndex));
        setCharIndex(charIndex + 1);
      }, 100);
      return () => clearTimeout(timeout);
    } else {
      const timeout = setTimeout(() => {
        setPlaceholderText("");
        setCharIndex(0);
        setPromptIndex((promptIndex + 1) % PROMPTS.length);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [charIndex, promptIndex, isGenerating]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
    }
  }, [inputText]);

  useEffect(() => {
    if (chatAreaRef.current) chatAreaRef.current.scrollTop = 0;
  }, [threads, selectedThread]);

  // --- INPUT HANDLERS ---
  const handleInputChange = (e) => setInputText(e.target.value);
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };
  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf("image") !== -1) {
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
              if (e.target?.result) setUploadedImages((prev) => [...prev, e.target.result]);
            };
            reader.readAsDataURL(file);
          }
        }
      }
    }
  };
  const handleFileUpload = (e) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (e.target?.result) setUploadedImages((prev) => [...prev, e.target.result]);
        };
        reader.readAsDataURL(file);
      });
    }
  };
  const removeUploadedImage = (index) => setUploadedImages((prev) => prev.filter((_, i) => i !== index));

  // --- NEW CHAT ---
  const createNewChat = () => {
    const newThread = {
      id: Date.now().toString(),
      title: "New Chat",
      messages: [],
      createdAt: new Date(),
      isFrozen: false,
      galleryImages: [],
      galleryPrompt: "",
      galleryTaskIds: [],
      isNewChat: true,
      shots: [],
    };
    setThreads((prev) => [newThread, ...prev.filter(t => t.id !== "excel-new-1")]);
    setSelectedThread(newThread.id);
    setIsGenerating(false);
    setSelectedImageIndex(null);
  };

  // --- SEND MESSAGE ---
  const handleSendMessage = async () => {
    if (!inputText.trim() && uploadedImages.length === 0) return;
    if (isGenerating) return;
    const thread = threads.find((t) => t.id === selectedThread);
    if (!thread || thread.isFrozen) return;
    setIsGenerating(true);

    const newMessage = {
      id: Date.now().toString(),
      text: inputText,
      isUser: true,
      uploadedImages: [...uploadedImages],
      timestamp: new Date(),
    };

    setThreads((prevThreads) =>
      prevThreads.map((thread) =>
        thread.id === selectedThread
          ? {
              ...thread,
              messages: [...thread.messages, newMessage],
              title: thread.messages.length === 0
                ? inputText.slice(0, 80)
                : thread.title,
            }
          : thread,
      ),
    );
    setInputText("");
    setUploadedImages([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      const formData = new FormData();
      if (newMessage.uploadedImages.length > 0) {
        const base64Data = newMessage.uploadedImages[0];
        const response = await fetch(base64Data);
        const blob = await response.blob();
        formData.append("data", blob, "uploaded-image.jpeg");
      }
      formData.append("text", newMessage.text);

      await fetch(AD_WEBHOOK_URL, {
        method: "POST",
        body: formData,
      });

      await new Promise(res => setTimeout(res, 2000));
      await fetchGoogleSheetData();

      setTimeout(() => {
        setThreads(prev => {
          const idx = sheetConversations.findIndex(
            c => c.prompt?.trim() === newMessage.text.trim()
          );
          if (idx >= 0) {
            setSelectedThread(`sheet-${idx + 1}`);
          }
          return prev;
        });
      }, 1000);

      setIsGenerating(false);
      setSelectedImageIndex(null);
    } catch (err) {
      setIsGenerating(false);
      alert("Failed to generate ad. Please try again.");
    }
  };

  // --- GALLERY CLICK ---
  const handleGalleryImageClick = (index) => {
    console.log("Gallery image clicked:", index);
    setSelectedImageIndex(index);
  };

  const handleImageError = (threadId, imageIndex) => {
    console.error(`Image failed to load: thread ${threadId}, image ${imageIndex}`);
    setImageLoadErrors(prev => ({
      ...prev,
      [`${threadId}-${imageIndex}`]: true
    }));
  };

  const currentThread = threads.find((t) => t.id === selectedThread);

  // --- TOP BAR GALLERY ---
  function TopBarGallery() {
    if (!currentThread) return null;

    // Debounce function to prevent multiple rapid clicks
    const debounce = (func, wait) => {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
      };
    };

    // Debounced click handler
    const handleGalleryImageClick = useCallback(
      debounce((index) => {
        console.log("Gallery image clicked:", index);
        setSelectedImageIndex(index);
      }, 200),
      []
    );

    return (
      <div className="h-32 bg-[#f9fafe] border-b border-gray-200 p-4 flex items-center justify-center relative shadow-sm">
        {/* Debug button */}
        {/* <button
          className="absolute top-2 right-2 bg-red-500 text-white px-2 py-1 rounded text-xs"
          onClick={() => {
            console.log("Debug: Current thread:", currentThread);
            console.log("Debug: Gallery images:", currentThread.galleryImages);
            console.log("Debug: Selected image index:", selectedImageIndex);
          }}
        >
          Debug
        </button> */}

        {(currentThread.galleryImages && currentThread.galleryImages.length > 0) ? (
          <div className="flex gap-3 overflow-x-auto scrollbar-hide h-full justify-center">
            {currentThread.galleryImages.map((img, index) => (
              <div
                key={index}
                className={cn(
                  "flex-shrink-0 cursor-pointer h-full border-2 rounded-xl shadow-md flex flex-col items-center justify-center",
                  selectedImageIndex === index
                    ? "border-blue-400 bg-white"
                    : "border-transparent hover:border-blue-400 bg-[#eaf4fd]"
                )}
                onClick={() => handleGalleryImageClick(index)} // Use debounced handler
                style={{ width: 120, minHeight: 60, padding: 8 }}
                title={`Image ${index + 1}`}
              >
                <div className="text-xs text-blue-700 mb-1 font-semibold">
                  Image {index + 1}
                </div>
                {imageLoadErrors[`${currentThread.id}-${index}`] ? (
                  <div className="w-16 h-16 bg-gray-200 rounded-lg flex items-center justify-center text-gray-500 text-xs">
                    Failed to load
                  </div>
                ) : (
                  <img
                    src={img}
                    alt={`Ad image ${index + 1}`}
                    onError={() => handleImageError(currentThread.id, index)}
                    style={{
                      width: 56,
                      height: 56,
                      objectFit: "cover",
                      borderRadius: 8,
                      marginBottom: 8,
                      boxShadow: "0 4px 16px 0 rgba(80,80,180,0.13)",
                    }}
                    className="bg-white"
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-blue-400 text-base flex items-center justify-center h-full w-full font-medium">
            {isLoadingSheetData ? "Loading..." : "No images yet"}
          </div>
        )}
      </div>
    );
  }

  // --- IMAGE MODAL ---
  function ImageModal() {
    if (selectedImageIndex === null || !currentThread?.galleryImages[selectedImageIndex]) return null;

    const modalRef = useRef(null);

    useEffect(() => {
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          setSelectedImageIndex(null);
        }
      };

      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }, []);

    return (
      <div
        ref={modalRef}
        className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === modalRef.current) {
            setSelectedImageIndex(null);
          }
        }}
      >
        <div className="relative max-w-4xl w-full max-h-[80vh] p-4">
          <img
            src={currentThread.galleryImages[selectedImageIndex]}
            alt={`Enlarged ad image ${selectedImageIndex + 1}`}
            className="w-full h-auto max-h-[70vh] object-contain rounded-xl shadow-lg border-2 border-white bg-white"
          />
          <button
            className="absolute -top-12 right-0 w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg"
            onClick={(e) => {
              e.stopPropagation(); // Prevent click from bubbling to the modal background
              setSelectedImageIndex(null);
            }}
          >
            <X size={20} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-white flex font-sans">
      {/* Sidebar */}
      <div className="w-64 bg-[#f3f7fa] flex flex-col z-40 shadow-xl border-r border-gray-200">
        <div className="p-4 flex items-center gap-2">
          <div className="w-8 h-8 bg-white rounded-xl border border-blue-300 flex items-center justify-center shadow-sm">
            <MessageSquare size={18} className="text-blue-600" />
          </div>
          <span className="font-bold text-xl text-blue-700">AIGen</span>
        </div>
        <div className="px-4 pb-2">
          <button
            onClick={createNewChat}
            className="w-full bg-gradient-to-r from-blue-400 to-blue-300 border border-blue-200 rounded-lg px-3 py-2 text-sm font-bold text-white hover:from-blue-500 hover:to-blue-500 transition-all shadow-md"
          >
            + New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pt-2 pb-6">
          {threads.map((thread) => (
            <div
              key={thread.id}
              onClick={() => {
                setSelectedThread(thread.id);
                setSelectedImageIndex(null);
              }}
              className={cn(
                "px-3 py-2 text-sm font-semibold cursor-pointer transition-all rounded-xl mb-2 group shadow-sm",
                selectedThread === thread.id
                  ? "bg-white text-blue-800 border border-blue-300"
                  : "text-blue-700 hover:text-blue-900 hover:bg-blue-100",
              )}
              title={thread.messages[0]?.text || "New Chat"}
            >
              <div className="line-clamp-2 leading-tight">{thread.title}</div>
            </div>
          ))}
          {isLoadingSheetData && (
            <div className="px-3 py-4 text-center">
              <div className="text-sm text-blue-400 mb-2">
                Loading from Google Sheets...
              </div>
              <div className="flex justify-center">
                <div className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin"></div>
              </div>
            </div>
          )}
          <div className="px-3 py-2 border-t border-blue-200 mt-2">
            <div className="text-xs text-blue-500 text-center">
              {sheetConversations.length} conversations loaded
            </div>
          </div>
        </div>
      </div>
      {/* Main Content */}
      <div className="flex-1 bg-white flex flex-col">
        <TopBarGallery />
        <ImageModal />
        <div 
          ref={chatAreaRef} 
          className={`flex-1 overflow-y-auto p-6 pb-40 ${selectedImageIndex !== null ? 'hidden' : ''}`}
        >
          <div className="max-w-4xl mx-auto space-y-4">
            {isLoadingSheetData ? (
              <div className="flex justify-center items-center h-64">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
                  <div className="text-blue-500 font-medium">Loading data from Google Sheets...</div>
                </div>
              </div>
            ) : (
              <>
                {currentThread?.id === "excel-new-1" && (
                  <div className="flex justify-center items-center h-64">
                    <div className="text-center text-blue-500 font-medium">
                      Start a new conversation by typing a prompt below
                    </div>
                  </div>
                )}
                
                {currentThread?.messages?.[0]?.text && (
                  <div className="flex">
                    <div className="flex-1">
                      <div className={cn(
                        "p-4 rounded-xl max-w-2xl bg-blue-100 text-blue-900 ml-auto shadow-lg border border-blue-200"
                      )}>
                        <span className="font-semibold block text-center text-lg">
                          {currentThread.messages[0].text}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                {currentThread?.shots && currentThread.shots.length > 0 && (
                  <div className="space-y-4 bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 shadow-md">
                    <div className="text-blue-800 font-bold text-left mb-2">Output shot List:</div>
                    {currentThread.shots.map((shot, idx) => (
                      <div
                        key={shot.shot_number + (shot.shot_name || shot.shot_description || shot.description || "")}
                        className="mb-3 last:mb-0 border-l-4 border-blue-400 pl-4 py-2 bg-white/60 rounded-xl text-left shadow-sm"
                      >
                        <div className="font-bold text-blue-700 mb-1">
                          Shot {shot.shot_number}
                          {shot.shot_name && <>: {shot.shot_name}</>}
                        </div>
                        <div className="text-gray-900 whitespace-pre-line">
                          {shot.description || shot.shot_description}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {currentThread?.messages.slice(1).map((message) => (
                  <div key={message.id} className="flex">
                    <div className="flex-1">
                      <div
                        className={cn(
                          "p-4 rounded-xl max-w-2xl shadow-md border",
                          message.isUser ? "bg-blue-400 text-white ml-auto border-blue-300" : "bg-white text-gray-800 border-gray-200",
                        )}
                      >
                        <div className="whitespace-pre-wrap text-base leading-relaxed font-normal text-center">
                          {message.text && <span>{message.text}</span>}
                        </div>
                        {message.uploadedImages && message.uploadedImages.length > 0 && (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            {message.uploadedImages.map((image, index) => (
                              <img
                                key={index}
                                src={image}
                                alt={`Uploaded image ${index + 1}`}
                                className="w-full h-32 object-cover rounded-xl border-2 border-white/20 shadow-md"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {isGenerating && (
                  <div className="flex">
                    <div className="flex-1">
                      <div className="bg-blue-50 text-blue-700 p-4 rounded-xl max-w-2xl shadow-lg border border-blue-200">
                        <div className="flex items-center space-x-2">
                          <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:0.1s]"></div>
                          <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                          <span className="text-sm font-semibold text-blue-700">
                            Generating images...
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <div 
          className={`fixed bottom-0 left-64 right-0 bg-blue-100 border-t border-blue-200 p-6 z-50 shadow-lg ${selectedImageIndex !== null ? 'hidden' : ''}`}
        >
          {uploadedImages.length > 0 && (
            <div className="mb-4 flex gap-2 flex-wrap max-w-4xl mx-auto">
              {uploadedImages.map((image, index) => (
                <div key={index} className="relative">
                  <img
                    src={image}
                    alt={`Upload ${index + 1}`}
                    className="w-16 h-16 object-cover rounded-xl border border-blue-300 shadow"
                  />
                  <button
                    className="absolute -top-2 -right-2 w-6 h-6 p-0 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow"
                    onClick={() => removeUploadedImage(index)}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="max-w-4xl mx-auto">
            <div
              className={cn(
                "relative bg-white border-2 border-blue-200 rounded-xl p-4 transition-opacity shadow-xl",
                isGenerating && "opacity-50",
              )}
            >
              <div className="pr-20">
                <textarea
                  ref={textareaRef}
                  value={inputText}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={placeholderText || "Start typing your prompt here..."}
                  className="w-full resize-none border-0 p-0 focus:outline-none focus:ring-0 text-base min-h-[32px] max-h-48 bg-transparent text-gray-700 placeholder-blue-400 font-semibold"
                  rows={1}
                  disabled={isGenerating}
                />
              </div>
              <button
                className="absolute bottom-2 left-2 p-1 h-8 w-8 text-blue-400 hover:text-blue-600"
                onClick={() => fileInputRef.current?.click()}
                disabled={isGenerating}
              >
                <Paperclip size={20} />
              </button>
              <button
                onClick={handleSendMessage}
                disabled={
                  (!inputText.trim() && uploadedImages.length === 0) ||
                  isGenerating
                }
                className="absolute bottom-2 right-2 p-2 h-10 w-10 bg-blue-400 hover:bg-blue-500 disabled:opacity-50 rounded-full border-0 flex items-center justify-center shadow-lg"
              >
                {isGenerating ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send size={18} className="text-white" />
                )}
              </button>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>
      </div>
    </div>
  );
}
// "use client";
// import { useState, useRef, useEffect, useCallback } from "react";
// import {
//   MessageSquare,
//   Send,
//   Paperclip,
//   X,
//   Image as ImageIcon,
// } from "lucide-react";

// // --- KIE API CONFIG ---
// const KIE_API = "https://api.kie.ai/api/v1/gpt4o-image/record-info";
// const KIE_TOKEN = "9c864c5ce4567f00a4f21536abffabc3";
// const AD_WEBHOOK_URL = "https://vidgy.app.n8n.cloud/webhook/dfc4bb03-133f-4413-8f87-d6746addcf06";
// const GOOGLE_SHEET_ID = "133ZHExWO_6Jfdmx_VRntJG_XJuy7wTXgepPs78yRuyg";
// const PROMPTS = [
//   "Generate a modern smart touch panel UI design.",
//   "Show me a luxury home automation setup.",
//   "Create images of futuristic urban living spaces.",
//   "Design a minimalist touch switch interface.",
//   "Visualize smart home convenience features.",
//   "Illustrate a smart panel replacing traditional switches.",
//   "Concept art for a high-tech smart home control panel.",
//   "Render a user-friendly smart touch panel layout.",
// ];

// // --- UTILS ---
// function cn(...args) {
//   return args.filter(Boolean).join(" ");
// }

// function parseCSV(csvText) {
//   const lines = csvText.split('\n');
//   const result = [];
//   for (let i = 0; i < lines.length; i++) {
//     const line = lines[i].trim();
//     if (!line) continue;
//     const row = [];
//     let current = '';
//     let inQuotes = false;
//     for (let j = 0; j < line.length; j++) {
//       const char = line[j];
//       if (char === '"') {
//         inQuotes = !inQuotes;
//       } else if (char === ',' && !inQuotes) {
//         row.push(current.trim());
//         current = '';
//       } else {
//         current += char;
//       }
//     }
//     row.push(current.trim());
//     result.push(row);
//   }
//   return { data: result };
// }

// function isValidUrl(string) {
//   try {
//     new URL(string);
//     return true;
//   } catch (_) {
//     return false;
//   }
// }

// async function fetchKieImage(taskId) {
//   if (!taskId) return [];
//   try {
//     console.log("Fetching image for taskId:", taskId);
//     const resp = await fetch(
//       `${KIE_API}?taskId=${encodeURIComponent(taskId)}`,
//       {
//         headers: { 
//           Authorization: `Bearer ${KIE_TOKEN}`,
//           'Content-Type': 'application/json'
//         },
//       }
//     );
    
//     if (!resp.ok) {
//       console.error("Failed to fetch KIE image:", resp.status, resp.statusText);
//       return [];
//     }
    
//     const data = await resp.json();
//     console.log("KIE API response:", data);
    
//     // Extract image URLs from different possible response structures
//     let imageUrls = [];
    
//     // Try various response formats
//     if (data?.data?.image_urls && Array.isArray(data.data.image_urls)) {
//       imageUrls = data.data.image_urls;
//     } else if (data?.image_urls && Array.isArray(data.image_urls)) {
//       imageUrls = data.image_urls;
//     } else if (data?.data?.urls && Array.isArray(data.data.urls)) {
//       imageUrls = data.data.urls;
//     } else if (data?.urls && Array.isArray(data.urls)) {
//       imageUrls = data.urls;
//     } else if (data?.data?.response?.image_urls && Array.isArray(data.data.response.image_urls)) {
//       imageUrls = data.data.response.image_urls;
//     } else if (data?.response?.image_urls && Array.isArray(data.response.image_urls)) {
//       imageUrls = data.response.image_urls;
//     }
    
//     // Filter valid URLs
//     const validUrls = imageUrls.filter(url => url && isValidUrl(url));
//     console.log("Valid image URLs:", validUrls);
    
//     return validUrls;
    
//   } catch (error) {
//     console.error("Error fetching KIE image:", error);
//     return [];
//   }
// }

// async function getAllImagesForTaskIds(taskIds) {
//   if (!taskIds || taskIds.length === 0) return [];
//   console.log("Fetching images for task IDs:", taskIds);
  
//   try {
//     const results = await Promise.allSettled(
//       taskIds.map(taskId => fetchKieImage(taskId))
//     );
    
//     const successfulResults = results
//       .filter(result => result.status === 'fulfilled')
//       .map(result => result.value)
//       .flat();
    
//     console.log("All fetched images:", successfulResults);
//     return successfulResults;
//   } catch (error) {
//     console.error("Error in getAllImagesForTaskIds:", error);
//     return [];
//   }
// }

// // --- MAIN COMPONENT ---
// export default function App() {
//   const [placeholderText, setPlaceholderText] = useState("");
//   const [promptIndex, setPromptIndex] = useState(0);
//   const [charIndex, setCharIndex] = useState(0);
//   const [sheetConversations, setSheetConversations] = useState([]);
//   const [threads, setThreads] = useState([]);
//   const [selectedThread, setSelectedThread] = useState("excel-new-1");
//   const [inputText, setInputText] = useState("");
//   const [uploadedImages, setUploadedImages] = useState([]);
//   const [isGenerating, setIsGenerating] = useState(false);
//   const [isLoadingSheetData, setIsLoadingSheetData] = useState(true);
//   const [selectedImageIndex, setSelectedImageIndex] = useState(null);
//   const [imageLoadErrors, setImageLoadErrors] = useState({});
//   const [imageLoadingStates, setImageLoadingStates] = useState({});

//   const textareaRef = useRef(null);
//   const fileInputRef = useRef(null);
//   const chatAreaRef = useRef(null);

//   // --- SHEET LOADER ---
//   const fetchGoogleSheetData = useCallback(async () => {
//     try {
//       setIsLoadingSheetData(true);
//       const csvUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv&gid=2100534081`;
//       const response = await fetch(csvUrl, { method: "GET", headers: { Accept: "text/csv" } });
//       if (!response.ok) throw new Error(`Failed to fetch sheet data: ${response.status}`);
//       const csvText = await response.text();
//       const { data: rows } = parseCSV(csvText);
//       const header = rows[0];
//       const conversations = [];
      
//       for (let i = 1; i < rows.length; i++) {
//         const row = rows[i];
//         if (!row || row.length < 3) continue;
        
//         const prompt = row[0]?.trim() || "";
//         let outputShotList = "";
//         let imageLinksRaw = "";
        
//         header.forEach((h, idx) => {
//           if (h.toLowerCase().includes("output shot")) outputShotList = row[idx]?.trim() || "";
//           if (h.toLowerCase().includes("image task id")) imageLinksRaw = row[idx]?.trim() || "";
//         });
        
//         outputShotList = outputShotList || row[1]?.trim() || "";
//         imageLinksRaw = imageLinksRaw || row[2]?.trim() || "";

//         let shots = [];
//         if (outputShotList) {
//           try {
//             let parsed = outputShotList;
//             if (typeof parsed === 'string') {
//               parsed = JSON.parse(parsed.replace(/'/g, '"'));
//             }
//             if (Array.isArray(parsed)) {
//               shots = parsed.map((s, idx) => {
//                 if (typeof s === "object") {
//                   return {
//                     shot_number: Number(s.shot_number) || idx + 1,
//                     shot_name: s.shot_name,
//                     shot_description: s.shot_description,
//                     description: s.description || s.shot_description || s.output || "",
//                   };
//                 }
//                 return {
//                   shot_number: idx + 1,
//                   description: s,
//                 };
//               }).filter(Boolean);
//             }
//           } catch {
//             shots = [{
//               shot_number: 1,
//               description: outputShotList,
//             }];
//           }
//         }

//         let taskIds = [];
//         if (imageLinksRaw) {
//           try {
//             // Clean the string first
//             const cleaned = imageLinksRaw.replace(/['"\[\]]/g, '').trim();
//             if (cleaned.includes(",")) {
//               taskIds = cleaned.split(",").map(x => x.trim()).filter(Boolean);
//             } else if (cleaned.length > 0) {
//               taskIds = [cleaned];
//             }
//           } catch {
//             console.log("Failed to parse task IDs:", imageLinksRaw);
//           }
//         }

//         conversations.push({ prompt, shots, taskIds });
//       }
      
//       setSheetConversations(conversations);
//     } catch (error) {
//       console.error("Error loading sheet data:", error);
//       setSheetConversations([]);
//     } finally {
//       setIsLoadingSheetData(false);
//     }
//   }, []);

//   // --- LOAD SHEET INITIALLY ---
//   useEffect(() => {
//     fetchGoogleSheetData();
//   }, [fetchGoogleSheetData]);

//   // --- BUILD THREADS FROM SHEET ---
//   useEffect(() => {
//     if (!isLoadingSheetData && sheetConversations.length > 0) {
//       (async () => {
//         const sheetThreads = [];
//         for (let index = 0; index < sheetConversations.length; index++) {
//           const conv = sheetConversations[index];
//           let galleryImages = [];
          
//           if (conv.taskIds && conv.taskIds.length > 0) {
//             console.log(`Loading images for conversation ${index + 1}:`, conv.taskIds);
//             galleryImages = await getAllImagesForTaskIds(conv.taskIds);
//           }
          
//           const threadId = `sheet-${index + 1}`;
//           const userMessage = {
//             id: `${threadId}-user`,
//             text: conv.prompt,
//             isUser: true,
//             uploadedImages: [],
//             timestamp: new Date(Date.now() - (sheetConversations.length - index) * 60000),
//           };
          
//           sheetThreads.push({
//             id: threadId,
//             title: conv.prompt.slice(0, 80) || `Conversation ${index + 1}`,
//             messages: [userMessage],
//             createdAt: new Date(Date.now() - (sheetConversations.length - index) * 60000),
//             isFrozen: true,
//             galleryImages,
//             galleryPrompt: conv.prompt || "",
//             galleryTaskIds: conv.taskIds || [],
//             shots: conv.shots || [],
//           });
//         }
        
//         setThreads([
//           {
//             id: "excel-new-1",
//             title: "New Chat",
//             messages: [],
//             createdAt: new Date(),
//             isFrozen: false,
//             galleryImages: [],
//             galleryPrompt: "",
//             galleryTaskIds: [],
//             isNewChat: true,
//             shots: [],
//           },
//           ...sheetThreads,
//         ]);
//       })();
//     }
//   }, [isLoadingSheetData, sheetConversations]);

//   // --- PLACEHOLDER ANIMATION ---
//   useEffect(() => {
//     if (isGenerating) return;
//     const currentPrompt = PROMPTS[promptIndex];
//     if (charIndex < currentPrompt.length) {
//       const timeout = setTimeout(() => {
//         setPlaceholderText((prev) => prev + currentPrompt.charAt(charIndex));
//         setCharIndex(charIndex + 1);
//       }, 100);
//       return () => clearTimeout(timeout);
//     } else {
//       const timeout = setTimeout(() => {
//         setPlaceholderText("");
//         setCharIndex(0);
//         setPromptIndex((promptIndex + 1) % PROMPTS.length);
//       }, 2000);
//       return () => clearTimeout(timeout);
//     }
//   }, [charIndex, promptIndex, isGenerating]);

//   useEffect(() => {
//     const textarea = textareaRef.current;
//     if (textarea) {
//       textarea.style.height = "auto";
//       textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
//     }
//   }, [inputText]);

//   useEffect(() => {
//     if (chatAreaRef.current) chatAreaRef.current.scrollTop = 0;
//   }, [threads, selectedThread]);

//   // --- INPUT HANDLERS ---
//   const handleInputChange = (e) => setInputText(e.target.value);
//   const handleKeyDown = (e) => {
//     if (e.key === "Enter" && !e.shiftKey) {
//       e.preventDefault();
//       handleSendMessage();
//     }
//   };
//   const handlePaste = (e) => {
//     const items = e.clipboardData?.items;
//     if (items) {
//       for (let i = 0; i < items.length; i++) {
//         const item = items[i];
//         if (item.type.indexOf("image") !== -1) {
//           const file = item.getAsFile();
//           if (file) {
//             const reader = new FileReader();
//             reader.onload = (e) => {
//               if (e.target?.result) setUploadedImages((prev) => [...prev, e.target.result]);
//             };
//             reader.readAsDataURL(file);
//           }
//         }
//       }
//     }
//   };
//   const handleFileUpload = (e) => {
//     const files = e.target.files;
//     if (files) {
//       Array.from(files).forEach((file) => {
//         const reader = new FileReader();
//         reader.onload = (e) => {
//           if (e.target?.result) setUploadedImages((prev) => [...prev, e.target.result]);
//         };
//         reader.readAsDataURL(file);
//       });
//     }
//   };
//   const removeUploadedImage = (index) => setUploadedImages((prev) => prev.filter((_, i) => i !== index));

//   // --- NEW CHAT ---
//   const createNewChat = () => {
//     const newThread = {
//       id: Date.now().toString(),
//       title: "New Chat",
//       messages: [],
//       createdAt: new Date(),
//       isFrozen: false,
//       galleryImages: [],
//       galleryPrompt: "",
//       galleryTaskIds: [],
//       isNewChat: true,
//       shots: [],
//     };
//     setThreads((prev) => [newThread, ...prev.filter(t => t.id !== "excel-new-1")]);
//     setSelectedThread(newThread.id);
//     setIsGenerating(false);
//     setSelectedImageIndex(null);
//   };

//   // --- SEND MESSAGE ---
//   const handleSendMessage = async () => {
//     if (!inputText.trim() && uploadedImages.length === 0) return;
//     if (isGenerating) return;
//     const thread = threads.find((t) => t.id === selectedThread);
//     if (!thread || thread.isFrozen) return;
//     setIsGenerating(true);

//     const newMessage = {
//       id: Date.now().toString(),
//       text: inputText,
//       isUser: true,
//       uploadedImages: [...uploadedImages],
//       timestamp: new Date(),
//     };

//     setThreads((prevThreads) =>
//       prevThreads.map((thread) =>
//         thread.id === selectedThread
//           ? {
//               ...thread,
//               messages: [...thread.messages, newMessage],
//               title: thread.messages.length === 0
//                 ? inputText.slice(0, 80)
//                 : thread.title,
//             }
//           : thread,
//       ),
//     );
//     setInputText("");
//     setUploadedImages([]);
//     if (textareaRef.current) textareaRef.current.style.height = "auto";

//     try {
//       const formData = new FormData();
//       if (newMessage.uploadedImages.length > 0) {
//         const base64Data = newMessage.uploadedImages[0];
//         const response = await fetch(base64Data);
//         const blob = await response.blob();
//         formData.append("data", blob, "uploaded-image.jpeg");
//       }
//       formData.append("text", newMessage.text);

//       await fetch(AD_WEBHOOK_URL, {
//         method: "POST",
//         body: formData,
//       });

//       await new Promise(res => setTimeout(res, 2000));
//       await fetchGoogleSheetData();

//       setTimeout(() => {
//         setThreads(prev => {
//           const idx = sheetConversations.findIndex(
//             c => c.prompt?.trim() === newMessage.text.trim()
//           );
//           if (idx >= 0) {
//             setSelectedThread(`sheet-${idx + 1}`);
//           }
//           return prev;
//         });
//       }, 1000);

//       setIsGenerating(false);
//       setSelectedImageIndex(null);
//     } catch (err) {
//       console.error("Error sending message:", err);
//       setIsGenerating(false);
//       alert("Failed to generate ad. Please try again.");
//     }
//   };

//   // --- IMAGE HANDLERS ---
//   const handleImageError = (threadId, imageIndex, imageUrl) => {
//     console.error(`Image failed to load: thread ${threadId}, image ${imageIndex}`, imageUrl);
//     setImageLoadErrors(prev => ({
//       ...prev,
//       [`${threadId}-${imageIndex}`]: true
//     }));
//   };

//   const handleImageLoad = (threadId, imageIndex) => {
//     setImageLoadingStates(prev => ({
//       ...prev,
//       [`${threadId}-${imageIndex}`]: false
//     }));
//   };

//   const retryImageLoad = (threadId, imageIndex) => {
//     setImageLoadErrors(prev => {
//       const newErrors = {...prev};
//       delete newErrors[`${threadId}-${imageIndex}`];
//       return newErrors;
//     });
//     setImageLoadingStates(prev => ({
//       ...prev,
//       [`${threadId}-${imageIndex}`]: true
//     }));
//   };

//   const currentThread = threads.find((t) => t.id === selectedThread);

//   // --- TOP BAR GALLERY ---
//   function TopBarGallery() {
//     if (!currentThread) return null;

//     return (
//       <div className="h-32 bg-[#f9fafe] border-b border-gray-200 p-4 flex items-center justify-center relative shadow-sm">
//         {/* Debug button */}
//         <button
//           className="absolute top-2 right-2 bg-blue-500 text-white px-2 py-1 rounded text-xs"
//           onClick={() => {
//             console.log("Current thread:", currentThread);
//             console.log("Gallery images:", currentThread.galleryImages);
//             console.log("Gallery task IDs:", currentThread.galleryTaskIds);
//           }}
//         >
//           Debug
//         </button>

//         {currentThread.galleryImages && currentThread.galleryImages.length > 0 ? (
//           <div className="flex gap-3 overflow-x-auto scrollbar-hide h-full justify-center">
//             {currentThread.galleryImages.map((img, index) => (
//               <div
//                 key={index}
//                 className={cn(
//                   "flex-shrink-0 cursor-pointer h-full border-2 rounded-xl shadow-md flex flex-col items-center justify-center",
//                   selectedImageIndex === index
//                     ? "border-blue-400 bg-white"
//                     : "border-transparent hover:border-blue-400 bg-[#eaf4fd]"
//                 )}
//                 onClick={() => setSelectedImageIndex(index)}
//                 style={{ width: 120, minHeight: 60, padding: 8 }}
//                 title={`Image ${index + 1}`}
//               >
//                 <div className="text-xs text-blue-700 mb-1 font-semibold">
//                   Image {index + 1}
//                 </div>
                
//                 {imageLoadErrors[`${currentThread.id}-${index}`] ? (
//                   <div className="w-16 h-16 bg-gray-200 rounded-lg flex flex-col items-center justify-center text-gray-500 text-xs p-1">
//                     <div>Failed to load</div>
//                     <button 
//                       onClick={(e) => {
//                         e.stopPropagation();
//                         retryImageLoad(currentThread.id, index);
//                       }}
//                       className="mt-1 text-blue-500 hover:text-blue-700 text-xs"
//                     >
//                       Retry
//                     </button>
//                   </div>
//                 ) : imageLoadingStates[`${currentThread.id}-${index}`] !== false ? (
//                   <div className="w-16 h-16 bg-gray-200 rounded-lg flex items-center justify-center">
//                     <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
//                   </div>
//                 ) : (
//                   <img
//                     src={img}
//                     alt={`Ad image ${index + 1}`}
//                     onLoad={() => handleImageLoad(currentThread.id, index)}
//                     onError={() => handleImageError(currentThread.id, index, img)}
//                     style={{
//                       width: 56,
//                       height: 56,
//                       objectFit: "cover",
//                       borderRadius: 8,
//                       marginBottom: 8,
//                       boxShadow: "0 4px 16px 0 rgba(80,80,180,0.13)",
//                     }}
//                     className="bg-white"
//                   />
//                 )}
//               </div>
//             ))}
//           </div>
//         ) : (
//           <div className="text-blue-400 text-base flex items-center justify-center h-full w-full font-medium">
//             {isLoadingSheetData ? "Loading..." : "No images yet"}
//           </div>
//         )}
//       </div>
//     );
//   }

//   // --- IMAGE MODAL ---
//   function ImageModal() {
//     if (selectedImageIndex === null || !currentThread?.galleryImages[selectedImageIndex]) return null;

//     const modalRef = useRef(null);

//     useEffect(() => {
//       const handleEscape = (e) => {
//         if (e.key === 'Escape') {
//           setSelectedImageIndex(null);
//         }
//       };

//       document.addEventListener('keydown', handleEscape);
//       return () => document.removeEventListener('keydown', handleEscape);
//     }, []);

//     return (
//       <div
//         ref={modalRef}
//         className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm"
//         onClick={(e) => {
//           if (e.target === modalRef.current) {
//             setSelectedImageIndex(null);
//           }
//         }}
//       >
//         <div className="relative max-w-4xl w-full max-h-[80vh] p-4">
//           <img
//             src={currentThread.galleryImages[selectedImageIndex]}
//             alt={`Enlarged ad image ${selectedImageIndex + 1}`}
//             className="w-full h-auto max-h-[70vh] object-contain rounded-xl shadow-lg border-2 border-white bg-white"
//           />
//           <button
//             className="absolute -top-12 right-0 w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg"
//             onClick={() => setSelectedImageIndex(null)}
//           >
//             <X size={20} />
//           </button>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className="h-screen bg-white flex font-sans">
//       {/* Sidebar */}
//       <div className="w-64 bg-[#f3f7fa] flex flex-col z-40 shadow-xl border-r border-gray-200">
//         <div className="p-4 flex items-center gap-2">
//           <div className="w-8 h-8 bg-white rounded-xl border border-blue-300 flex items-center justify-center shadow-sm">
//             <MessageSquare size={18} className="text-blue-600" />
//           </div>
//           <span className="font-bold text-xl text-blue-700">AIGen</span>
//         </div>
//         <div className="px-4 pb-2">
//           <button
//             onClick={createNewChat}
//             className="w-full bg-gradient-to-r from-blue-400 to-blue-300 border border-blue-200 rounded-lg px-3 py-2 text-sm font-bold text-white hover:from-blue-500 hover:to-blue-500 transition-all shadow-md"
//           >
//             + New Chat
//           </button>
//         </div>
//         <div className="flex-1 overflow-y-auto px-4 pt-2 pb-6">
//           {threads.map((thread) => (
//             <div
//               key={thread.id}
//               onClick={() => {
//                 setSelectedThread(thread.id);
//                 setSelectedImageIndex(null);
//               }}
//               className={cn(
//                 "px-3 py-2 text-sm font-semibold cursor-pointer transition-all rounded-xl mb-2 group shadow-sm",
//                 selectedThread === thread.id
//                   ? "bg-white text-blue-800 border border-blue-300"
//                   : "text-blue-700 hover:text-blue-900 hover:bg-blue-100",
//               )}
//               title={thread.messages[0]?.text || "New Chat"}
//             >
//               <div className="line-clamp-2 leading-tight">{thread.title}</div>
//             </div>
//           ))}
//           {isLoadingSheetData && (
//             <div className="px-3 py-4 text-center">
//               <div className="text-sm text-blue-400 mb-2">
//                 Loading from Google Sheets...
//               </div>
//               <div className="flex justify-center">
//                 <div className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin"></div>
//               </div>
//             </div>
//           )}
//           <div className="px-3 py-2 border-t border-blue-200 mt-2">
//             <div className="text-xs text-blue-500 text-center">
//               {sheetConversations.length} conversations loaded
//             </div>
//           </div>
//         </div>
//       </div>
//       {/* Main Content */}
//       <div className="flex-1 bg-white flex flex-col">
//         <TopBarGallery />
//         <ImageModal />
//         <div 
//           ref={chatAreaRef} 
//           className={`flex-1 overflow-y-auto p-6 pb-40 ${selectedImageIndex !== null ? 'hidden' : ''}`}
//         >
//           <div className="max-w-4xl mx-auto space-y-4">
//             {isLoadingSheetData ? (
//               <div className="flex justify-center items-center h-64">
//                 <div className="text-center">
//                   <div className="w-8 h-8 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
//                   <div className="text-blue-500 font-medium">Loading data from Google Sheets...</div>
//                 </div>
//               </div>
//             ) : (
//               <>
//                 {currentThread?.id === "excel-new-1" && (
//                   <div className="flex justify-center items-center h-64">
//                     <div className="text-center text-blue-500 font-medium">
//                       Start a new conversation by typing a prompt below
//                     </div>
//                   </div>
//                 )}
                
//                 {currentThread?.messages?.[0]?.text && (
//                   <div className="flex">
//                     <div className="flex-1">
//                       <div className={cn(
//                         "p-4 rounded-xl max-w-2xl bg-blue-100 text-blue-900 ml-auto shadow-lg border border-blue-200"
//                       )}>
//                         <span className="font-semibold block text-center text-lg">
//                           {currentThread.messages[0].text}
//                         </span>
//                       </div>
//                     </div>
//                   </div>
//                 )}
//                 {currentThread?.shots && currentThread.shots.length > 0 && (
//                   <div className="space-y-4 bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 shadow-md">
//                     <div className="text-blue-800 font-bold text-left mb-2">Output shot List:</div>
//                     {currentThread.shots.map((shot, idx) => (
//                       <div
//                         key={idx}
//                         className="mb-3 last:mb-0 border-l-4 border-blue-400 pl-4 py-2 bg-white/60 rounded-xl text-left shadow-sm"
//                       >
//                         <div className="font-bold text-blue-700 mb-1">
//                           Shot {shot.shot_number || idx + 1}
//                           {shot.shot_name && <>: {shot.shot_name}</>}
//                         </div>
//                         <div className="text-gray-900 whitespace-pre-line">
//                           {shot.description || shot.shot_description}
//                         </div>
//                       </div>
//                     ))}
//                   </div>
//                 )}
//                 {currentThread?.messages.slice(1).map((message) => (
//                   <div key={message.id} className="flex">
//                     <div className="flex-1">
//                       <div
//                         className={cn(
//                           "p-4 rounded-xl max-w-2xl shadow-md border",
//                           message.isUser ? "bg-blue-400 text-white ml-auto border-blue-300" : "bg-white text-gray-800 border-gray-200",
//                         )}
//                       >
//                         <div className="whitespace-pre-wrap text-base leading-relaxed font-normal text-center">
//                           {message.text && <span>{message.text}</span>}
//                         </div>
//                         {message.uploadedImages && message.uploadedImages.length > 0 && (
//                           <div className="mt-3 grid grid-cols-2 gap-2">
//                             {message.uploadedImages.map((image, index) => (
//                               <img
//                                 key={index}
//                                 src={image}
//                                 alt={`Uploaded image ${index + 1}`}
//                                 className="w-full h-32 object-cover rounded-xl border-2 border-white/20 shadow-md"
//                               />
//                             ))}
//                           </div>
//                         )}
//                       </div>
//                     </div>
//                   </div>
//                 ))}
//                 {isGenerating && (
//                   <div className="flex">
//                     <div className="flex-1">
//                       <div className="bg-blue-50 text-blue-700 p-4 rounded-xl max-w-2xl shadow-lg border border-blue-200">
//                         <div className="flex items-center space-x-2">
//                           <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
//                           <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:0.1s]"></div>
//                           <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
//                           <span className="text-sm font-semibold text-blue-700">
//                             Generating images...
//                           </span>
//                         </div>
//                       </div>
//                     </div>
//                   </div>
//                 )}
//               </>
//             )}
//           </div>
//         </div>
//         <div 
//           className={`fixed bottom-0 left-64 right-0 bg-blue-100 border-t border-blue-200 p-6 z-50 shadow-lg ${selectedImageIndex !== null ? 'hidden' : ''}`}
//         >
//           {uploadedImages.length > 0 && (
//             <div className="mb-4 flex gap-2 flex-wrap max-w-4xl mx-auto">
//               {uploadedImages.map((image, index) => (
//                 <div key={index} className="relative">
//                   <img
//                     src={image}
//                     alt={`Upload ${index + 1}`}
//                     className="w-16 h-16 object-cover rounded-xl border border-blue-300 shadow"
//                   />
//                   <button
//                     className="absolute -top-2 -right-2 w-6 h-6 p-0 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow"
//                     onClick={() => removeUploadedImage(index)}
//                   >
//                     <X size={12} />
//                   </button>
//                 </div>
//               ))}
//             </div>
//           )}
//           <div className="max-w-4xl mx-auto">
//             <div
//               className={cn(
//                 "relative bg-white border-2 border-blue-200 rounded-xl p-4 transition-opacity shadow-xl",
//                 isGenerating && "opacity-50",
//               )}
//             >
//               <div className="pr-20">
//                 <textarea
//                   ref={textareaRef}
//                   value={inputText}
//                   onChange={handleInputChange}
//                   onKeyDown={handleKeyDown}
//                   onPaste={handlePaste}
//                   placeholder={placeholderText || "Start typing your prompt here..."}
//                   className="w-full resize-none border-0 p-0 focus:outline-none focus:ring-0 text-base min-h-[32px] max-h-48 bg-transparent text-gray-700 placeholder-blue-400 font-semibold"
//                   rows={1}
//                   disabled={isGenerating}
//                 />
//               </div>
//               <button
//                 className="absolute bottom-2 left-2 p-1 h-8 w-8 text-blue-400 hover:text-blue-600"
//                 onClick={() => fileInputRef.current?.click()}
//                 disabled={isGenerating}
//               >
//                 <Paperclip size={20} />
//               </button>
//               <button
//                 onClick={handleSendMessage}
//                 disabled={
//                   (!inputText.trim() && uploadedImages.length === 0) ||
//                   isGenerating
//                 }
//                 className="absolute bottom-2 right-2 p-2 h-10 w-10 bg-blue-400 hover:bg-blue-500 disabled:opacity-50 rounded-full border-0 flex items-center justify-center shadow-lg"
//               >
//                 {isGenerating ? (
//                   <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
//                 ) : (
//                   <Send size={18} className="text-white" />
//                 )}
//               </button>
//             </div>
//           </div>
//           <input
//             ref={fileInputRef}
//             type="file"
//             multiple
//             accept="image/*"
//             onChange={handleFileUpload}
//             className="hidden"
//           />
//         </div>
//       </div>
//     </div>
//   );
// }