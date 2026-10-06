// ============================================================
// VIRTUAL ASSISTANT NEXUS
// MAIN JAVASCRIPT
// ============================================================


// ============================================================
// CSRF TOKEN (forms protected; JSON APIs read it if required)
// ============================================================

function csrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : "";
}

function jsonHeaders(extra = {}) {
    const headers = { "Content-Type": "application/json", ...extra };
    const token = csrfToken();
    if (token) {
        headers["X-CSRFToken"] = token;
    }
    return headers;
}


// ============================================================
// CHAT INPUT
// ============================================================

let activeConversationId = null;
let readAloudEnabled = localStorage.getItem("nexusReadAloud") === "true";
const isAuthenticated = document.body.dataset.authenticated === "true";
let reminderCache = [];
let activeSpeechRecognition = null;
let activeVoiceController = null;
let voiceStoppedByUser = false;

const messageInput =
    document.getElementById("messageInput");


// Allow Enter key to send message

if (messageInput) {

    messageInput.addEventListener(
        "keydown",
        function(event) {

            if (event.key === "Enter") {

                sendMessage();

            }

        }
    );

}


// ============================================================
// SEND MESSAGE
// ============================================================

async function sendMessage(options = {}) {
    const input = document.getElementById("messageInput");
    if (!input) {
        return null;
    }

    const message = input.value.trim();
    if (!message) {
        return null;
    }

    addMessage("You", message, "user");
    input.value = "";
    input.disabled = true;

    const sendButtons = document.querySelectorAll(".send-button");
    sendButtons.forEach(function(button) {
        button.disabled = true;
    });

    showTypingIndicator();
    let assistantReply = null;
    const voiceController = options.voice ? new AbortController() : null;
    if (voiceController) {
        activeVoiceController = voiceController;
        setVoiceActivity("Nexus is thinking...", "thinking");
    }

    try {
        const requestOptions = {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: message,
                conversation_id: activeConversationId
            })
        };
        if (voiceController) {
            requestOptions.signal = voiceController.signal;
        }
        const response = await fetch(options.voice ? "/api/voice" : "/api/chat", requestOptions);
        const data = await response.json();
        removeTypingIndicator();

        if (data.success) {
            assistantReply = data.response;
            if (data.conversation_id) {
                activeConversationId = data.conversation_id;
            }
            addMessage("Nexus", assistantReply, "nexus");
            if (isAuthenticated) {
                loadChatHistory();
            }
            if (options.speak || readAloudEnabled) {
                speak(assistantReply);
            }
        } else {
            addMessage("Nexus", data.message || "Sorry, something went wrong.", "nexus");
        }
    } catch (error) {
        removeTypingIndicator();
        if (error.name !== "AbortError") {
            console.error(error);
            addMessage("Nexus", "Unable to connect to the server.", "nexus");
        }
    } finally {
        if (voiceController && activeVoiceController === voiceController) {
            activeVoiceController = null;
        }
        input.disabled = false;
        sendButtons.forEach(function(button) {
            button.disabled = false;
        });
        input.focus();
    }

    return assistantReply;
}


// ============================================================
// NEW CHAT
// ============================================================

function newChat() {

    const chatMessages =
        document.getElementById(
            "chatMessages"
        );

    if (!chatMessages) {

        return;

    }

    activeConversationId = null;

    // Clear the conversation and show a fresh greeting

    chatMessages.innerHTML = `

        <div class="message">

            <div class="message-avatar">N</div>

            <div class="message-content">

                <strong>Nexus</strong>

                <p>Hello! I am Nexus. How can I help you today?</p>

            </div>

        </div>

    `;


    const input =
        document.getElementById(
            "messageInput"
        );


    if (input) {

        input.disabled = false;

        input.focus();

    }

    if (isAuthenticated) {
        loadChatHistory();
    } else {
        renderChatHistory();
    }

}


async function loadChatHistory() {

    if (!isAuthenticated) {
        return;
    }

    try {
        const response = await fetch("/api/chats");
        const data = await response.json();
        if (data.success) {
            renderChatHistory(data.conversations);
        }
    } catch (error) {
        console.error("Could not load chat history:", error);
    }

}


function renderChatHistory(conversations = []) {

    const list = document.getElementById("chatHistoryList");
    if (!list) {
        return;
    }

    list.replaceChildren();
    if (!conversations.length) {
        const empty = document.createElement("p");
        empty.className = "history-empty";
        empty.textContent = "Your saved chats will appear here.";
        list.appendChild(empty);
        return;
    }

    conversations.forEach(function(conversation) {
        const row = document.createElement("div");
        row.className = "history-row" +
            (conversation.id === activeConversationId ? " active" : "");
        row.dataset.conversationId = String(conversation.id);

        const openButton = document.createElement("button");
        openButton.className = "history-open";
        openButton.type = "button";
        openButton.textContent = conversation.title;
        openButton.title = conversation.title;
        openButton.addEventListener("click", function() {
            openChat(conversation.id);
        });

        const actions = document.createElement("div");
        actions.className = "history-actions";

        const menuButton = document.createElement("button");
        menuButton.className = "history-menu-trigger";
        menuButton.type = "button";
        menuButton.textContent = "···";
        menuButton.title = "Conversation actions";
        menuButton.setAttribute("aria-label", "Actions for " + conversation.title);
        menuButton.setAttribute("aria-haspopup", "menu");
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.addEventListener("click", function(event) {
            event.stopPropagation();
            toggleChatMenu(row, conversation);
        });

        actions.appendChild(menuButton);
        row.append(openButton, actions);
        list.appendChild(row);
    });

}


function closeChatMenus(exceptRow = null) {
    document.querySelectorAll(".history-menu").forEach(function(menu) {
        const row = menu.closest(".history-row");
        if (row !== exceptRow) {
            menu.remove();
            const trigger = row && row.querySelector(".history-menu-trigger");
            if (trigger) {
                trigger.setAttribute("aria-expanded", "false");
            }
        }
    });
}


function toggleChatMenu(row, conversation) {
    const existingMenu = row.querySelector(".history-menu");
    if (existingMenu) {
        closeChatMenus();
        return;
    }

    closeChatMenus(row);
    const trigger = row.querySelector(".history-menu-trigger");
    const menu = document.createElement("div");
    menu.className = "history-menu";
    menu.setAttribute("role", "menu");

    const renameAction = document.createElement("button");
    renameAction.type = "button";
    renameAction.textContent = "Rename";
    renameAction.setAttribute("role", "menuitem");
    renameAction.addEventListener("click", function() {
        closeChatMenus();
        renameChat(conversation.id, conversation.title);
    });

    const deleteAction = document.createElement("button");
    deleteAction.type = "button";
    deleteAction.className = "history-delete-action";
    deleteAction.textContent = "Delete";
    deleteAction.setAttribute("role", "menuitem");
    deleteAction.addEventListener("click", function(event) {
        event.stopPropagation();
        showDeleteChatConfirmation(conversation, menu);
    });

    menu.append(renameAction, deleteAction);
    row.querySelector(".history-actions").appendChild(menu);
    trigger.setAttribute("aria-expanded", "true");
}


function showDeleteChatConfirmation(conversation, menu) {
    menu.replaceChildren();

    const prompt = document.createElement("p");
    prompt.className = "history-delete-prompt";
    prompt.textContent = "Delete this chat?";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", function() {
        closeChatMenus();
    });

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "history-delete-action";
    confirmButton.textContent = "Delete chat";
    confirmButton.addEventListener("click", function() {
        deleteChat(conversation.id);
    });

    menu.append(prompt, cancelButton, confirmButton);
}


async function deleteChat(conversationId) {
    try {
        const response = await fetch("/api/chats/" + conversationId, {
            method: "DELETE"
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showFeatureToast(data.message || "Could not delete this chat.");
            return;
        }

        if (String(activeConversationId) === String(conversationId)) {
            newChat();
        } else {
            loadChatHistory();
        }
        showFeatureToast("Chat deleted.");
    } catch (error) {
        console.error("Could not delete conversation:", error);
        showFeatureToast("Could not delete this chat.");
    }
}


async function openChat(conversationId) {

    try {
        const response = await fetch("/api/chats/" + conversationId);
        const data = await response.json();
        if (!data.success) {
            showFeatureToast(data.message || "Could not open this conversation.");
            return;
        }

        activeConversationId = data.conversation.id;
        const messages = document.getElementById("chatMessages");
        if (messages) {
            messages.replaceChildren();
            data.conversation.messages.forEach(function(message) {
                addMessage(
                    message.role === "user" ? "You" : "Nexus",
                    message.content,
                    message.role === "user" ? "user" : "nexus"
                );
            });
        }
        loadChatHistory();
    } catch (error) {
        console.error("Could not open conversation:", error);
        showFeatureToast("Could not open this conversation.");
    }

}


async function renameChat(conversationId, currentTitle) {
    const row = document.querySelector(
        '.history-row[data-conversation-id="' + conversationId + '"]'
    );
    if (!row || row.querySelector(".history-rename-input")) {
        return;
    }

    const titleInput = document.createElement("input");
    titleInput.className = "history-rename-input";
    titleInput.type = "text";
    titleInput.maxLength = 120;
    titleInput.value = currentTitle;
    titleInput.setAttribute("aria-label", "Conversation title");
    const openButton = row.querySelector(".history-open");
    const menuButton = row.querySelector(".history-menu-trigger");
    openButton.replaceWith(titleInput);
    menuButton.hidden = true;
    titleInput.focus();
    titleInput.select();

    let finished = false;
    async function saveTitle() {
        if (finished) {
            return;
        }
        finished = true;
        const title = titleInput.value.trim();
        if (!title) {
            loadChatHistory();
            return;
        }
        try {
            const response = await fetch("/api/chats/" + conversationId, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: title })
            });
            const data = await response.json();
            if (!data.success) {
                showFeatureToast(data.message || "Could not rename this conversation.");
            }
            loadChatHistory();
        } catch (error) {
            console.error("Could not rename conversation:", error);
            showFeatureToast("Could not rename this conversation.");
        }
    }

    titleInput.addEventListener("keydown", function(event) {
        if (event.key === "Enter") {
            saveTitle();
        } else if (event.key === "Escape") {
            finished = true;
            loadChatHistory();
        }
    });
    titleInput.addEventListener("blur", saveTitle);
}


// ============================================================
// TOGGLE PASSWORD VISIBILITY
// ============================================================

function togglePassword(button) {

    const input =
        document.getElementById(
            button.dataset.target
        );


    if (!input) {

        return;

    }


    const isHidden =
        input.type === "password";


    input.type =
        isHidden ? "text" : "password";


    button.textContent =
        isHidden ? "🙈" : "👁️";

    button.title = isHidden ? "Hide password" : "Show password";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(isHidden));

}


// ============================================================
// ADD MESSAGE TO CHAT
// ============================================================

function addMessage(
    sender,
    message,
    type
) {

    const chatMessages =
        document.getElementById(
            "chatMessages"
        );


    if (!chatMessages) {

        return;

    }


    const messageElement =
        document.createElement("div");


    messageElement.className =
        "message " + type + "-message";


    let avatar = "N";


    if (type === "user") {

        avatar = "U";

    }


    messageElement.innerHTML = `

        <div class="message-avatar">

            ${avatar}

        </div>

        <div class="message-content">

            <strong>${escapeHTML(sender)}</strong>

            <p>${escapeHTML(message)}</p>

        </div>

    `;


    chatMessages.appendChild(
        messageElement
    );


    // Scroll to bottom

    chatMessages.scrollTop =
        chatMessages.scrollHeight;

}


// ============================================================
// TYPING INDICATOR
// ============================================================

function showTypingIndicator() {

    const chatMessages =
        document.getElementById(
            "chatMessages"
        );


    if (!chatMessages) {

        return;

    }


    if (
        document.getElementById(
            "typingIndicator"
        )
    ) {

        return;

    }


    const typingElement =
        document.createElement("div");


    typingElement.id = "typingIndicator";

    typingElement.className =
        "message nexus-message typing-message";


    typingElement.innerHTML = `

        <div class="message-avatar">N</div>

        <div class="message-content">

            <div class="typing-dots">

                <span></span>

                <span></span>

                <span></span>

            </div>

        </div>

    `;


    chatMessages.appendChild(
        typingElement
    );


    chatMessages.scrollTop =
        chatMessages.scrollHeight;

}


function removeTypingIndicator() {

    const indicator =
        document.getElementById(
            "typingIndicator"
        );


    if (indicator) {

        indicator.remove();

    }

}


// ============================================================
// QUICK MESSAGE
// ============================================================

function sendQuickMessage(message) {

    if (document.getElementById("panel-chat")) {
        switchWorkspaceTab("chat");
    }

    const input =
        document.getElementById(
            "messageInput"
        );


    if (input) {

        input.value = message;

        sendMessage();

    }

}


// ============================================================
// VOICE ASSISTANT
// ============================================================

function startVoiceAssistant() {
    beginVoiceCapture(false);
}


function beginVoiceCapture(showVoicePanel) {
    const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        showFeatureToast("Speech recognition is not supported in this browser.");
        return;
    }

    const recognition = new SpeechRecognition();
    activeSpeechRecognition = recognition;
    voiceStoppedByUser = false;
    let receivedResult = false;
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = function() {
        setVoiceActivity("Listening... speak now", "listening");
    };

    recognition.onresult = async function(event) {
        const transcript = Array.from(event.results)
            .map(function(result) { return result[0].transcript; })
            .join("");
        const finalResult = event.results[event.results.length - 1].isFinal;
        setVoiceActivity(
            finalResult ? "Nexus is thinking..." : transcript,
            finalResult ? "thinking" : "listening"
        );
        if (!finalResult) {
            return;
        }

        receivedResult = true;
        const input = document.getElementById("messageInput");
        const responsePanel = document.getElementById("voiceResponse");
        if (input) {
            input.value = transcript;
        }
        if (responsePanel && showVoicePanel) {
            responsePanel.classList.add("show");
            responsePanel.textContent = "Nexus is thinking...";
        }

        const reply = await sendMessage({ voice: true, speak: true });
        if (responsePanel && showVoicePanel) {
            responsePanel.textContent = reply || "Could not reach Nexus.";
        }
        setVoiceActivity("Nexus replied", "ready");
    };

    recognition.onerror = function(event) {
        setVoiceActivity("Voice error: " + event.error, "error");
    };

    recognition.onend = function() {
        if (activeSpeechRecognition === recognition) {
            activeSpeechRecognition = null;
        }
        document.querySelectorAll(".voice-orb").forEach(function(button) {
            button.classList.remove("listening");
        });
        if (voiceStoppedByUser) {
            setVoiceActivity("Voice stopped", "ready");
        } else if (!receivedResult) {
            setVoiceActivity("Ready to listen", "ready");
        }
    };

    try {
        recognition.start();
    } catch (error) {
        console.error("Could not start speech recognition:", error);
        setVoiceActivity("Microphone could not start", "error");
    }
}


function stopVoiceAssistant() {
    voiceStoppedByUser = true;

    if (activeSpeechRecognition) {
        activeSpeechRecognition.stoppedByUser = true;
        activeSpeechRecognition.abort();
        activeSpeechRecognition = null;
    }

    if (activeVoiceController) {
        activeVoiceController.abort();
        activeVoiceController = null;
    }

    if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
    }

    removeTypingIndicator();
    const input = document.getElementById("messageInput");
    if (input) {
        input.disabled = false;
    }
    document.querySelectorAll(".send-button").forEach(function(button) {
        button.disabled = false;
    });
    setVoiceActivity("Voice stopped", "ready");
}


function setVoiceActivity(message, state) {
    ["chatVoiceStatus", "voiceStatus"].forEach(function(id) {
        const status = document.getElementById(id);
        if (status) {
            status.textContent = message;
        }
    });

    document.querySelectorAll(".voice-activity").forEach(function(activity) {
        activity.dataset.state = state;
    });
    document.querySelectorAll(".voice-orb").forEach(function(button) {
        button.classList.toggle("listening", state === "listening");
    });
    document.querySelectorAll(".voice-stop-button").forEach(function(stopButton) {
        stopButton.disabled = !["listening", "thinking", "speaking"].includes(state);
    });
}


// ============================================================
// TEXT TO SPEECH
// ============================================================

function speak(text) {

    if (!("speechSynthesis" in window)) {

        return;

    }


    window.speechSynthesis.cancel();
    voiceStoppedByUser = false;
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = "en-US";
    speech.rate = 1;
    speech.pitch = 1;
    speech.onstart = function() {
        setVoiceActivity("Nexus is speaking...", "speaking");
    };
    speech.onend = function() {
        if (!voiceStoppedByUser) {
            setVoiceActivity("Ready to listen", "ready");
        }
    };
    window.speechSynthesis.speak(speech);

}


function toggleReadAloud() {
    readAloudEnabled = !readAloudEnabled;
    localStorage.setItem("nexusReadAloud", String(readAloudEnabled));
    const toggle = document.getElementById("speakToggle");
    if (toggle) {
        toggle.setAttribute("aria-pressed", String(readAloudEnabled));
        toggle.classList.toggle("active", readAloudEnabled);
    }
    showFeatureToast(readAloudEnabled ? "Read-aloud replies enabled." : "Read-aloud replies disabled.");
}


// ============================================================
// HTML SECURITY
// ============================================================

function escapeHTML(text) {

    const div =
        document.createElement("div");

    div.textContent = text;

    return div.innerHTML;

}


// ============================================================
// WORKSPACE TABS (ALL FEATURES IN ONE FRAME)
// ============================================================

function switchWorkspaceTab(tab) {

    const tabs =
        document.querySelectorAll(
            ".workspace-tab"
        );


    tabs.forEach(
        function(button) {

            const selected = button.dataset.tab === tab;
            button.classList.toggle("active", selected);
            button.setAttribute("aria-selected", String(selected));

        }
    );


    const panels =
        document.querySelectorAll(
            ".workspace-panel"
        );


    panels.forEach(
        function(panel) {

            const selected = panel.id === "panel-" + tab;
            panel.classList.toggle("active", selected);
            panel.setAttribute("aria-hidden", String(!selected));

        }
    );


    // Load fresh data when a panel opens

    if (tab === "memory") {

        loadMemories();

    }


    if (tab === "productivity") {

        updateProductivityClock();

        renderReminders();

    }


    if (tab === "chat") {

        const input =
            document.getElementById(
                "messageInput"
            );


        if (input) {

            setTimeout(function() {

                input.focus();

            }, 250);

        }

    }

}


// ============================================================
// FEATURE TOAST
// ============================================================

function showFeatureToast(message) {

    let toast =
        document.getElementById(
            "featureToast"
        );


    if (!toast) {

        toast =
            document.createElement("div");

        toast.id = "featureToast";

        toast.className =
            "feature-toast";

        document.body.appendChild(
            toast
        );

    }


    toast.textContent = message;

    toast.classList.add("show");


    clearTimeout(
        toast._timer
    );


    toast._timer =
        setTimeout(function() {

            toast.classList.remove("show");

        }, 3500);

}


// ============================================================
// VOICE PAGE
// ============================================================

function startVoiceOnPage() {

    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;


    if (!SpeechRecognition) {

        alert(
            "Voice recognition is not supported in this browser."
        );

        return;

    }


    const micButton =
        document.getElementById(
            "micButton"
        );


    if (micButton) {

        micButton.classList.add(
            "listening"
        );

    }


    const statusEl =
        document.getElementById(
            "voiceStatus"
        );


    if (statusEl) {

        statusEl.textContent =
            "Listening... speak now";

    }


    const recognition =
        new SpeechRecognition();


    recognition.lang = "en-US";

    recognition.continuous = false;

    recognition.interimResults = false;


    recognition.start();


    recognition.onresult =
        async function(event) {

            const transcript =
                event.results[0][0].transcript;


            if (statusEl) {

                statusEl.textContent =
                    "You said: " + transcript;

            }


            const responseEl =
                document.getElementById(
                    "voiceResponse"
                );


            if (responseEl) {

                responseEl.classList.add(
                    "show"
                );

                responseEl.textContent =
                    "Nexus is thinking...";

            }


            try {

                const response =
                    await fetch("/api/chat", {

                        method: "POST",

                        headers: {
                            "Content-Type": "application/json"
                        },

                        body: JSON.stringify({
                            message: transcript
                        })

                    });


                const data =
                    await response.json();


                if (responseEl) {

                    responseEl.textContent =
                        "🎙️ \"" + transcript + "\"\n\n" +
                        (data.response ||
                            "Sorry, I didn't get that.");

                }

            } catch (error) {

                console.error(error);


                if (responseEl) {

                    responseEl.textContent =
                        "Could not reach Nexus.";

                }

            }

        };


    recognition.onerror =
        function(event) {

            if (statusEl) {

                statusEl.textContent =
                    "Voice error: " + event.error;

            }

        };


    recognition.onend =
        function() {

            if (micButton) {

                micButton.classList.remove(
                    "listening"
                );

            }


            if (statusEl) {

                statusEl.textContent =
                    "Click the mic to speak";

            }

        };

}


// ============================================================
// AUTOMATION PAGE
// ============================================================

async function runAutomationCommand(command) {

    showFeatureToast(
        "Running: " + command
    );


    const resultEl =
        document.getElementById(
            "automationResult"
        );


    if (resultEl) {

        resultEl.classList.add("show");

        resultEl.textContent =
            "Running command...";

    }


    try {

        const response =
            await fetch("/api/automation", {

                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    command: command
                })

            });


        const data =
            await response.json();


        if (resultEl) {

            resultEl.textContent =
                data.message ||
                "Command executed.";

        }

    } catch (error) {

        console.error(error);


        if (resultEl) {

            resultEl.textContent =
                "Automation failed.";

        }

    }

}


function runCustomAutomation() {

    const input =
        document.getElementById(
            "automationInput"
        );


    if (!input) {

        return;

    }


    const command =
        input.value.trim();


    if (!command) {

        showFeatureToast(
            "Type a command first."
        );

        return;

    }


    input.value = "";

    runAutomationCommand(command);

}


// ============================================================
// EMOTION PAGE
// ============================================================

const EMOTION_FACES = {
    happy: "😊",
    excited: "🤩",
    love: "❤️",
    sad: "😔",
    angry: "😠",
    anxious: "😟",
    fear: "😨",
    surprise: "😲",
    disgust: "🤢",
    tired: "😴",
    confused: "😕",
    neutral: "😐"
};

const EMOTION_LABELS = {
    happy: "Happy",
    excited: "Excited",
    love: "Love",
    sad: "Sad",
    angry: "Angry",
    anxious: "Anxious",
    fear: "Fear",
    surprise: "Surprised",
    disgust: "Disgusted",
    tired: "Tired",
    confused: "Confused",
    neutral: "Neutral"
};

const EMOTION_REPLIES = {
    happy: "Wonderful to hear that! Keep that positive energy going.",
    excited: "Love that excitement! Channel it into something great today.",
    love: "That warmth matters. Take a moment to appreciate it.",
    sad: "Take a moment to relax, I’m here if you want to talk.",
    angry: "Take a slow breath. Want to talk through what frustrated you?",
    anxious: "Take a moment to relax. One small step at a time — I’m here.",
    fear: "You’re safe here. Tell me what’s worrying you.",
    surprise: "Unexpected moments can be a lot. Want to share more?",
    disgust: "That sounds unpleasant. Want to clear your mind with something else?",
    tired: "Rest matters. Consider a short break — I can wait.",
    confused: "That’s okay to feel. Tell me more and we’ll sort it together.",
    neutral: "Thanks for sharing. I’m here whenever you want to talk."
};

function selectEmotionOption(text) {
    const textarea = document.getElementById("emotionText");
    if (textarea) {
        textarea.value = text;
    }
    analyzeEmotion();
}

function getRecentEmotions() {
    try {
        return JSON.parse(localStorage.getItem("nexus_recent_emotions") || "[]");
    } catch (error) {
        return [];
    }
}

function saveRecentEmotion(emotion, text) {
    const entry = {
        emotion: emotion,
        text: (text || "").slice(0, 80),
        time: new Date().toLocaleString(),
    };
    const history = getRecentEmotions();
    history.unshift(entry);
    try {
        localStorage.setItem("nexus_recent_emotions", JSON.stringify(history.slice(0, 8)));
    } catch (error) {
        console.error(error);
    }
    renderRecentEmotions();
}

function renderRecentEmotions() {
    const listEl = document.getElementById("recentEmotionsList");
    if (!listEl) {
        return;
    }
    const history = getRecentEmotions();
    if (!history.length) {
        listEl.innerHTML = '<div class="emotion-recent-empty">No emotions analyzed yet.</div>';
        return;
    }
    listEl.innerHTML = history.map(function (item) {
        const face = EMOTION_FACES[item.emotion] || "😐";
        const label = EMOTION_LABELS[item.emotion] || item.emotion;
        return '<div class="emotion-recent-item"><span>' + face + '</span><span>' + label + '</span><time>' + item.time + '</time></div>';
    }).join("");
}

function clearRecentEmotions() {
    try {
        localStorage.removeItem("nexus_recent_emotions");
    } catch (error) {
        console.error(error);
    }
    renderRecentEmotions();
}

async function analyzeEmotion() {

    const textarea =
        document.getElementById(
            "emotionText"
        );


    const message =
        textarea ? textarea.value.trim() : "";


    showFeatureToast(
        message ?
        "Analyzing emotion..." :
        "Type how you feel first."
    );


    if (!message) {

        return;

    }


    try {

        const response =
            await fetch("/api/emotion", {

                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    message: message
                })

            });


        const data =
            await response.json();


        const emotion =
            data.emotion || "neutral";


        const faceEl =
            document.getElementById(
                "emotionFace"
            );


        const labelEl =
            document.getElementById(
                "emotionLabel"
            );


        const strengthEl =
            document.getElementById(
                "emotionStrength"
            );


        const replyEl =
            document.getElementById(
                "emotionNexusReply"
            );


        if (faceEl) {

            faceEl.textContent =
                EMOTION_FACES[emotion] || "😐";

        }


        if (labelEl) {

            labelEl.textContent =
                EMOTION_LABELS[emotion] || emotion;

        }


        if (strengthEl) {

            const matches = (data.matches !== undefined && data.matches !== null) ? data.matches : 0;
            const method = data.method || "keyword";
            strengthEl.textContent =
                method + " method · " + matches + " match" + (matches === 1 ? "" : "es");

        }


        if (replyEl) {

            replyEl.textContent =
                EMOTION_REPLIES[emotion] || EMOTION_REPLIES.neutral;

        }

        saveRecentEmotion(emotion, message);

    } catch (error) {

        console.error(error);

        showFeatureToast(
            "Emotion detection failed."
        );

    }

}


// ============================================================
// MEMORY PAGE
// ============================================================

async function loadMemories() {

    const listEl =
        document.getElementById(
            "memoryList"
        );


    if (!listEl) {

        return;

    }


    try {

        const response =
            await fetch("/api/memory");


        const data =
            await response.json();


        const memories =
            data.memory || [];


        if (memories.length === 0) {

            listEl.innerHTML =
                '<p class="memory-empty">Nothing remembered yet. Add something above.</p>';

            return;

        }


        listEl.innerHTML = "";


        memories.forEach(
            function(memory) {

                const item =
                    document.createElement("div");

                item.className = "memory-item";

                item.innerHTML =
                    '<span class="memory-bullet"></span>' +
                    '<span>' + escapeHTML(memory) + '</span>';


                listEl.appendChild(item);

            }
        );

    } catch (error) {

        console.error(error);

    }

}


async function saveMemory() {

    const input =
        document.getElementById(
            "memoryInput"
        );


    if (!input) {

        return;

    }


    const text =
        input.value.trim();


    if (!text) {

        showFeatureToast(
            "Type something to remember."
        );

        return;

    }


    input.value = "";


    try {

        const response = await fetch("/api/memory", {

            method: "POST",

            headers: jsonHeaders(),

            body: JSON.stringify({
                text: text
            })

        });

        const data = await response.json().catch(function() {
            return {};
        });

        if (!response.ok || data.success === false) {
            showFeatureToast(
                (data && data.message) || "Please log in to save memories."
            );

            return;
        }


        showFeatureToast(
            "Nexus will remember that."
        );


        loadMemories();

    } catch (error) {

        console.error(error);

        showFeatureToast(
            "Could not save memory."
        );

    }

}


// ============================================================
// PRODUCTIVITY PAGE
// ============================================================

function updateProductivityClock() {

    const clockEl =
        document.getElementById(
            "productivityClock"
        );


    const dateEl =
        document.getElementById(
            "productivityDate"
        );


    const now =
        new Date();


    if (clockEl) {

        clockEl.textContent =
            now.toLocaleTimeString(
                undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                }
            );

    }


    if (dateEl) {

        dateEl.textContent =
            now.toLocaleDateString(
                undefined, {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric"
                }
            );

    }

}


function getReminders() {
    try {
        const reminders = JSON.parse(localStorage.getItem("nexusReminders") || "[]");
        return reminders.map(function(reminder, index) {
            if (typeof reminder === "string") {
                return { id: "legacy-" + index, text: reminder, due_at: null, completed: false };
            }
            return reminder;
        });
    } catch (error) {
        return [];
    }
}


function saveReminders(list) {
    localStorage.setItem("nexusReminders", JSON.stringify(list));
}


async function renderReminders() {
    const listEl = document.getElementById("reminderList");
    if (!listEl) {
        return;
    }

    try {
        if (isAuthenticated) {
            const response = await fetch("/api/reminders");
            const data = await response.json();
            if (!data.success) {
                throw new Error(data.message || "Reminder request failed");
            }
            reminderCache = data.reminders;
        } else {
            reminderCache = getReminders();
        }
        renderReminderItems(listEl, reminderCache);
        updateBriefingFromReminders(reminderCache);
        checkReminderNotifications(reminderCache);
    } catch (error) {
        console.error("Could not load reminders:", error);
        listEl.textContent = "Could not load reminders.";
    }
}


function renderReminderItems(listEl, reminders) {
    listEl.replaceChildren();
    if (!reminders.length) {
        const empty = document.createElement("p");
        empty.className = "reminder-empty";
        empty.textContent = "No reminders yet. Add one above.";
        listEl.appendChild(empty);
        return;
    }

    reminders.forEach(function(reminder) {
        const item = document.createElement("div");
        item.className = "reminder-item" + (reminder.completed ? " completed" : "");
        if (reminder.due_at && new Date(reminder.due_at) < new Date() && !reminder.completed) {
            item.classList.add("overdue");
        }

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = reminder.completed;
        checkbox.setAttribute("aria-label", "Mark " + reminder.text + " complete");
        checkbox.addEventListener("change", function() {
            toggleReminder(reminder.id, checkbox.checked);
        });

        const textBlock = document.createElement("div");
        textBlock.className = "reminder-text";
        const label = document.createElement("span");
        label.className = "reminder-label";
        label.textContent = reminder.text;
        textBlock.appendChild(label);

        const due = document.createElement("time");
        due.className = "reminder-due";
        due.textContent = reminder.due_at ?
            new Date(reminder.due_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) :
            "No due date";
        textBlock.appendChild(due);

        const remove = document.createElement("button");
        remove.className = "remove-reminder";
        remove.type = "button";
        remove.textContent = "×";
        remove.title = "Delete reminder";
        remove.setAttribute("aria-label", "Delete reminder: " + reminder.text);
        remove.addEventListener("click", function() {
            removeReminder(reminder.id);
        });

        item.append(checkbox, textBlock, remove);
        listEl.appendChild(item);
    });
}


async function addReminder() {
    const input = document.getElementById("reminderInput");
    const dueInput = document.getElementById("reminderDueAt");
    if (!input) {
        return;
    }

    const text = input.value.trim();
    if (!text) {
        showFeatureToast("Type a reminder first.");
        return;
    }

    const reminder = {
        text: text,
        due_at: dueInput && dueInput.value ? dueInput.value : null,
        completed: false
    };

    try {
        if (isAuthenticated) {
            const response = await fetch("/api/reminders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(reminder)
            });
            const data = await response.json();
            if (!data.success) {
                showFeatureToast(data.message || "Could not add reminder.");
                return;
            }
        } else {
            reminder.id = "local-" + Date.now();
            reminder.due_at = reminder.due_at ? new Date(reminder.due_at).toISOString() : null;
            const reminders = getReminders();
            reminders.push(reminder);
            saveReminders(reminders);
        }

        input.value = "";
        if (dueInput) {
            dueInput.value = "";
        }
        await renderReminders();
        showFeatureToast("Reminder added.");
    } catch (error) {
        console.error("Could not add reminder:", error);
        showFeatureToast("Could not add reminder.");
    }
}


async function toggleReminder(reminderId, completed) {
    try {
        if (isAuthenticated) {
            await fetch("/api/reminders/" + reminderId, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ completed: completed })
            });
        } else {
            const reminders = getReminders().map(function(reminder) {
                return reminder.id === reminderId ? {...reminder, completed: completed } : reminder;
            });
            saveReminders(reminders);
        }
        await renderReminders();
    } catch (error) {
        console.error("Could not update reminder:", error);
        showFeatureToast("Could not update reminder.");
    }
}


async function removeReminder(reminderId) {
    try {
        if (isAuthenticated) {
            await fetch("/api/reminders/" + reminderId, { method: "DELETE" });
        } else {
            saveReminders(getReminders().filter(function(reminder) {
                return reminder.id !== reminderId;
            }));
        }
        await renderReminders();
    } catch (error) {
        console.error("Could not delete reminder:", error);
        showFeatureToast("Could not delete reminder.");
    }
}


function updateBriefingFromReminders(reminders) {
    const date = document.getElementById("todayDate");
    const summary = document.getElementById("briefingSummary");
    const pendingCount = document.getElementById("pendingCount");
    const overdueCount = document.getElementById("overdueCount");
    const upcoming = document.getElementById("briefingUpcoming");
    const now = new Date();
    if (date) {
        date.textContent = now.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric"
        });
    }

    const pending = reminders.filter(function(item) { return !item.completed; });
    const overdue = pending.filter(function(item) {
        return item.due_at && new Date(item.due_at) < now;
    });
    if (pendingCount) pendingCount.textContent = String(pending.length);
    if (overdueCount) overdueCount.textContent = String(overdue.length);
    if (summary) {
        summary.textContent = pending.length ?
            "You have " + pending.length + " open reminder" + (pending.length === 1 ? "" : "s") + " to keep in view." :
            "Your list is clear. Choose one useful thing to focus on today.";
    }

    if (upcoming) {
        upcoming.replaceChildren();
        const items = pending.filter(function(item) {
            return item.due_at && new Date(item.due_at) >= now;
        }).slice(0, 3);
        items.forEach(function(item) {
            const line = document.createElement("p");
            line.textContent = new Date(item.due_at).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit"
            }) + "  ·  " + item.text;
            upcoming.appendChild(line);
        });
    }
}


async function updateDailyBriefing() {
    if (!isAuthenticated || !document.getElementById("briefingSummary")) {
        return;
    }
    try {
        const response = await fetch("/api/briefing");
        const data = await response.json();
        if (data.success) {
            const summary = document.getElementById("briefingSummary");
            const pendingCount = document.getElementById("pendingCount");
            const overdueCount = document.getElementById("overdueCount");
            const date = document.getElementById("todayDate");
            if (summary) {
                summary.textContent = data.pending_count ?
                    "Your day has " + data.pending_count + " open reminder" +
                    (data.pending_count === 1 ? "" : "s") +
                    (data.overdue_count ? ", including " + data.overdue_count + " past due" : "") + "." :
                    "Your list is clear. Choose one useful thing to focus on today.";
            }
            if (pendingCount) pendingCount.textContent = String(data.pending_count);
            if (overdueCount) overdueCount.textContent = String(data.overdue_count);
            if (date) date.textContent = data.date;
        }
    } catch (error) {
        console.error("Could not load daily briefing:", error);
    }
}


function enableReminderNotifications() {
    if (!("Notification" in window)) {
        showFeatureToast("Browser notifications are not supported here.");
        return;
    }
    Notification.requestPermission().then(function(permission) {
        const button = document.getElementById("notificationButton");
        if (button && permission === "granted") {
            button.textContent = "Alerts on";
            button.disabled = true;
        }
        showFeatureToast(permission === "granted" ?
            "Reminder alerts enabled while Nexus is open." :
            "Notification permission was not granted.");
        checkReminderNotifications(reminderCache);
    });
}


function checkReminderNotifications(reminders) {
    if (!("Notification" in window) || Notification.permission !== "granted") {
        return;
    }
    const notified = new Set(JSON.parse(localStorage.getItem("nexusNotifiedReminders") || "[]"));
    reminders.forEach(function(reminder) {
        if (!reminder.completed && reminder.due_at &&
            new Date(reminder.due_at) <= new Date() && !notified.has(String(reminder.id))) {
            new Notification("Nexus reminder", { body: reminder.text });
            notified.add(String(reminder.id));
        }
    });
    localStorage.setItem("nexusNotifiedReminders", JSON.stringify(Array.from(notified)));
}


// ============================================================
// CHECK SERVER STATUS
// ============================================================

async function checkNexusStatus() {

    try {

        const response =
            await fetch("/api/status");


        const data =
            await response.json();


        if (data.success) {

            console.log(
                "Nexus status:",
                data.status
            );

        }

    } catch (error) {

        console.error(
            "Nexus server unavailable"
        );

    }

}


// ============================================================
// INITIALIZE
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    function() {

        const requestedTool = new URLSearchParams(window.location.search).get("tool");
        if (requestedTool && document.getElementById("panel-" + requestedTool)) {
            switchWorkspaceTab(requestedTool);
        }

        console.log(
            "================================"
        );

        console.log(
            "Virtual Assistant Nexus"
        );

        console.log(
            "Frontend initialized"
        );

        console.log(
            "================================"
        );

        document.addEventListener("click", function(event) {
            if (!event.target.closest(".history-actions")) {
                closeChatMenus();
            }
        });

        document.addEventListener("keydown", function(event) {
            if (event.key === "Escape") {
                closeChatMenus();
            }
        });


        checkNexusStatus();

        loadChatHistory();

        loadMemories();

        renderRecentEmotions();

        updateProductivityClock();

        renderReminders();

        updateDailyBriefing();

        const speakToggle = document.getElementById("speakToggle");
        if (speakToggle) {
            speakToggle.setAttribute("aria-pressed", String(readAloudEnabled));
            speakToggle.classList.toggle("active", readAloudEnabled);
        }

        const notificationButton = document.getElementById("notificationButton");
        if (notificationButton && "Notification" in window && Notification.permission === "granted") {
            notificationButton.textContent = "Alerts on";
            notificationButton.disabled = true;
        }


        setInterval(
            updateProductivityClock,
            1000
        );

        setInterval(function() {
            checkReminderNotifications(reminderCache);
        }, 30000);


        // Enter key shortcuts

        const automationInput =
            document.getElementById(
                "automationInput"
            );


        if (automationInput) {

            automationInput.addEventListener(
                "keydown",
                function(event) {

                    if (event.key === "Enter") {

                        runCustomAutomation();

                    }

                }
            );

        }


        const memoryInput =
            document.getElementById(
                "memoryInput"
            );


        if (memoryInput) {

            memoryInput.addEventListener(
                "keydown",
                function(event) {

                    if (event.key === "Enter") {

                        saveMemory();

                    }

                }
            );

        }


        const reminderInput =
            document.getElementById(
                "reminderInput"
            );


        if (reminderInput) {

            reminderInput.addEventListener(
                "keydown",
                function(event) {

                    if (event.key === "Enter") {

                        addReminder();

                    }

                }
            );

        }

    }
);