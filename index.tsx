/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session, Type} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

export interface AegisPermission {
  id: string;
  category: 'hardware' | 'calendar';
  name: string;
  description: string;
  status: 'approved' | 'revoked';
  lastAccessed: string;
}

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  // Original audio states
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';

  // Futuristic Chatbot States
  @state() bootProgress = 0;
  @state() isBooted = false;
  @state() isPermissionsOpen = false;
  @state() activePermissionCategory: 'all' | 'hardware' | 'calendar' = 'all';
  @state() permissions: AegisPermission[] = [
    {
      id: 'smart_lights',
      category: 'hardware',
      name: 'Smart Ambiance Lights',
      description: 'Allow Aegis to control brightness levels, hues, smart dimmers, and query fixture telemetry.',
      status: 'approved',
      lastAccessed: 'Never'
    },
    {
      id: 'thermostat',
      category: 'hardware',
      name: 'Smart Thermostat',
      description: 'Permit Aegis to regulate target HVAC temperatures and monitor home thermal telemetry.',
      status: 'approved',
      lastAccessed: 'Never'
    },
    {
      id: 'smart_lock',
      category: 'hardware',
      name: 'Smart Secure Lock',
      description: 'Enable Aegis to actuate physical locks, verify gate states, and issue digital secure keys.',
      status: 'revoked',
      lastAccessed: 'Never'
    },
    {
      id: 'security_camera',
      category: 'hardware',
      name: 'CCTV Live Video Feed',
      description: 'Provide live frame stream analysis, visual classification, and perimeter motion alarms.',
      status: 'revoked',
      lastAccessed: 'Never'
    },
    {
      id: 'calendar_personal',
      category: 'calendar',
      name: 'Personal Google Calendar',
      description: 'Sync personal Google Calendar timelines, read schedules, and insert new time blocks.',
      status: 'approved',
      lastAccessed: 'Never'
    },
    {
      id: 'calendar_work',
      category: 'calendar',
      name: 'Work Google Calendar',
      description: 'Access Workspace calendar free-busy states, create team invites, and inspect availability.',
      status: 'revoked',
      lastAccessed: 'Never'
    }
  ];
  @state() diagnosticLogs: Array<{ id: string; timestamp: string; message: string; details?: any; type: string }> = [];
  @state() chatHistory: Array<{ role: 'user' | 'model'; text: string; id: string; timestamp: string }> = [
    { role: 'model', text: 'Aegis AI Chatbot online. Speak or type a command to communicate with the neural interface.', id: 'welcome', timestamp: new Date().toLocaleTimeString() }
  ];
  @state() typedCommand = '';
  @state() aegisState: 'STANDBY' | 'LISTENING' | 'THINKING' | 'SPEAKING' = 'STANDBY';
  @state() currentTranscript = '';
  @state() currentAgentResponse = '';
  @state() isHistoryOpen = false;
  @state() voiceInteractions: Array<{
    id: string;
    timestamp: string;
    userText: string;
    agentText: string;
  }> = [];
  @state() userLocation: { latitude: number; longitude: number; accuracy: number; timestamp: number } | null = null;
  @state() locationError: string | null = null;
  @state() isLocating = false;

  private activeMessageId: string | null = null;
  private activeRecognition: any = null;
  private lastVoiceInteractionId: string | null = null;
  private client: GoogleGenAI;
  private session: Session;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();
  private timerInterval: any = null;

  // Let Tailwind CSS govern the visual rendering by deploying in Light DOM
  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.initClient();
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadPermissions();
    this.loadVoiceInteractions();
    this.loadUserLocation();
    this.runBootSequence();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.timerInterval) clearInterval(this.timerInterval);
  }

  private runBootSequence() {
    this.isBooted = false;
    this.bootProgress = 0;
    this.playSoundEffect('boot');
    this.addDiagnosticLog('Initializing Aegis AI Chatbot Neural Interface...', null, 'info');
    
    const interval = setInterval(() => {
      this.bootProgress += 4;
      if (this.bootProgress % 20 === 0) {
        this.addDiagnosticLog(`Loading Module ${this.bootProgress}%: ${this.getBootMessage(this.bootProgress)}`, null, 'info');
      }
      if (this.bootProgress >= 100) {
        clearInterval(interval);
        this.isBooted = true;
        this.addDiagnosticLog('Aegis AI Chatbot OS Online. WebSocket session channels operational.', null, 'success');
        this.playSoundEffect('success');
        this.speakGreeting('Aegis AI Chatbot initialized. Live session channels open.');
      }
    }, 100);
  }

  private getBootMessage(progress: number): string {
    switch(progress) {
      case 20: return 'Establishing WebSocket connection to Aegis Live...';
      case 40: return 'Calibrating AudioContext pipelines (16kHz / 24kHz)...';
      case 60: return 'Compiling custom 3D vertex displacement shaders...';
      case 80: return 'Initializing chat transcripts and UI workspaces...';
      default: return 'Optimizing neural synaptic paths...';
    }
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-3.1-flash-live-preview';

    try {
      this.updateStatus('Calibrating Neural Pathways...');
      this.addDiagnosticLog('Establishing real-time connection to Aegis AI Chatbot Live...', null, 'info');

      this.session = await this.client.live.connect({
        model: model,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [{ text: `You are Aegis, a highly advanced, real-time voice-and-text chatbot. Respond conversationally, concisely, and clearly. Keep responses naturally paced, engaging, and friendly.${this.userLocation ? ` The user's current real-time GPS location is Latitude: ${this.userLocation.latitude}, Longitude: ${this.userLocation.longitude} (accuracy ~${this.userLocation.accuracy}m). Feel free to refer to this if they ask about weather, location, recommendations, or coordinates.` : ''}

CURRENT USER SECURITY PERMISSIONS CONFIGURATION:
${this.permissions.map(p => `- ${p.name} (id: ${p.id}): ${p.status.toUpperCase()}`).join('\n')}

INSTRUCTIONS ON SECURITY BOUNDARIES:
1. If the user asks you to inspect or control a device, or access calendar schedules/events:
   - Check if the corresponding permission is APPROVED.
   - If it is APPROVED, respond enthusiastically and conversationally confirm you have carried out their command (e.g. "Adjusting your smart thermostat to 72°F", "Personal calendar synced - you have 2 meetings tomorrow").
   - If it is REVOKED, you MUST decline the request. Explicitly inform the user that access to that hardware or account is currently restricted/revoked, and ask them to enable it in the "Security & Permissions Hub" dashboard in the top-right toolbar if they want you to control it.` }]
          }
        },
        callbacks: {
          onopen: () => {
            this.updateStatus('Session Connected');
            this.addDiagnosticLog('Aegis AI Chatbot Live API WebSocket channel opened.', null, 'success');
          },
          onmessage: async (message: LiveServerMessage) => {
            // 1. Real-time User Input Transcription
            const inputTranscript = message.serverContent?.inputTranscription;
            if (inputTranscript?.text) {
              this.currentTranscript = inputTranscript.text;
              this.updateStatus(`Aegis transcribing: "${this.currentTranscript}"`);
              this.requestUpdate();

              if (inputTranscript.finished) {
                // Commit user utterance to chat history
                const userMsg = {
                  role: 'user' as const,
                  text: inputTranscript.text,
                  id: `user_${Date.now()}`,
                  timestamp: new Date().toLocaleTimeString()
                };
                this.chatHistory = [...this.chatHistory, userMsg];
                this.currentTranscript = '';

                // ALSO capture in voiceInteractions history!
                const voiceId = `voice_${Date.now()}`;
                this.lastVoiceInteractionId = voiceId;
                const newVoiceInteraction = {
                  id: voiceId,
                  timestamp: new Date().toLocaleString(),
                  userText: inputTranscript.text,
                  agentText: ''
                };
                this.voiceInteractions = [newVoiceInteraction, ...this.voiceInteractions];
                this.saveVoiceInteractions();

                this.requestUpdate();
                this.scrollToBottom();
              }
            }

            // 2. Real-time Model Output Transcription
            const outputTranscript = message.serverContent?.outputTranscription;
            if (outputTranscript?.text) {
              const textChunk = outputTranscript.text;
              this.currentAgentResponse += textChunk;

              if (!this.activeMessageId) {
                this.activeMessageId = `model_${Date.now()}`;
                const modelMsg = {
                  role: 'model' as const,
                  text: textChunk,
                  id: this.activeMessageId,
                  timestamp: new Date().toLocaleTimeString()
                };
                this.chatHistory = [...this.chatHistory, modelMsg];
              } else {
                this.chatHistory = this.chatHistory.map(msg => {
                  if (msg.id === this.activeMessageId) {
                    return { ...msg, text: msg.text + textChunk };
                  }
                  return msg;
                });
              }

              // Update the active voice interaction if there is one!
              if (this.lastVoiceInteractionId) {
                this.voiceInteractions = this.voiceInteractions.map(vi => {
                  if (vi.id === this.lastVoiceInteractionId) {
                    return { ...vi, agentText: vi.agentText + textChunk };
                  }
                  return vi;
                });
                this.saveVoiceInteractions();
              }

              this.aegisState = 'SPEAKING';
              this.updateStatus('Aegis transmitting vocal response...');
              this.requestUpdate();
              this.scrollToBottom();
            }

            // 3. Audio Chunk Output handling (24kHz Raw PCM playback)
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.inlineData) {
                  this.aegisState = 'SPEAKING';
                  this.nextStartTime = Math.max(
                    this.nextStartTime,
                    this.outputAudioContext.currentTime,
                  );

                  const audioBuffer = await decodeAudioData(
                    decode(part.inlineData.data),
                    this.outputAudioContext,
                    24000,
                    1,
                  );
                  const source = this.outputAudioContext.createBufferSource();
                  source.buffer = audioBuffer;
                  source.connect(this.outputNode);
                  source.addEventListener('ended', () => {
                    this.sources.delete(source);
                    if (this.sources.size === 0 && this.aegisState === 'SPEAKING') {
                      this.aegisState = 'STANDBY';
                      this.updateStatus('Aegis Neural Interface: Standby');
                    }
                  });

                  source.start(this.nextStartTime);
                  this.nextStartTime = this.nextStartTime + audioBuffer.duration;
                  this.sources.add(source);
                }
              }
            }

            // 4. Turn Completion Reset
            const turnComplete = message.serverContent?.turnComplete;
            if (turnComplete) {
              this.activeMessageId = null;
              this.currentAgentResponse = '';
            }

            // 5. Interruption Handling
            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              this.addDiagnosticLog('Aegis output stream interrupted by user verbal input.', null, 'warning');
              for (const source of this.sources.values()) {
                try {
                  source.stop();
                } catch (e) {}
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
              this.aegisState = 'STANDBY';
              this.activeMessageId = null;
              this.currentAgentResponse = '';
              this.updateStatus('Aegis Neural Interface: Standby');
              this.requestUpdate();
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message || 'Live Session Error');
            this.addDiagnosticLog(`Session Error: ${e.message}`, null, 'error');
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Session Disconnected');
            this.addDiagnosticLog(`Session Closed. Reason: ${e.reason || 'Normal Closure'}`, null, 'warning');
          }
        }
      });
    } catch (e: any) {
      console.error(e);
      this.addDiagnosticLog(`Failed to initialize Aegis Live API session: ${e.message || e}`, null, 'error');
    }
  }

  // Active Tool Call Handlers
  private scrollToBottom() {
    const chatContainer = this.querySelector('#chatContainer');
    if (chatContainer) {
      setTimeout(() => {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }, 50);
    }
  }

  // Native Synthesizer Sound Generator
  private playSoundEffect(type: 'boot' | 'activate' | 'timer_done' | 'click' | 'success' | 'warning') {
    try {
      const ctx = this.outputAudioContext;
      if (ctx.state === 'suspended') ctx.resume();
      
      const now = ctx.currentTime;
      if (type === 'boot') {
        const freqs = [150, 300, 600, 1200];
        freqs.forEach((f, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(f, now);
          osc.frequency.exponentialRampToValueAtTime(f * 1.5, now + 1.2);
          
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(0.04, now + 0.1 + idx * 0.1);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
          
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 1.5);
        });
      } else if (type === 'activate') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.setValueAtTime(1200, now + 0.08);
        osc.frequency.exponentialRampToValueAtTime(500, now + 0.2);
        
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'timer_done') {
        for (let i = 0; i < 4; i++) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(587.33, now + i * 0.4); // D5
          osc.frequency.linearRampToValueAtTime(1174.66, now + i * 0.4 + 0.25);
          
          gain.gain.setValueAtTime(0, now + i * 0.4);
          gain.gain.linearRampToValueAtTime(0.08, now + i * 0.4 + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.4 + 0.35);
          
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + i * 0.4);
          osc.stop(now + i * 0.4 + 0.35);
        }
      } else if (type === 'click') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, now);
        gain.gain.setValueAtTime(0.02, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'success') {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc1.frequency.setValueAtTime(523.25, now); // C5
        osc1.frequency.exponentialRampToValueAtTime(1046.5, now + 0.35);
        
        osc2.frequency.setValueAtTime(659.25, now); // E5
        osc2.frequency.exponentialRampToValueAtTime(1318.51, now + 0.35);
        
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.05, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.4);
        osc2.stop(now + 0.4);
      } else if (type === 'warning') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.linearRampToValueAtTime(180, now + 0.4);
        
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.5);
      }
    } catch (e) {
      console.warn('Could not play sound effect:', e);
    }
  }

  private speakResponse(text: string) {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const siriVoice = voices.find(
        v => v.name.toLowerCase().includes('google us english') || 
             v.name.toLowerCase().includes('male') ||
             v.name.toLowerCase().includes('samantha') ||
             v.name.toLowerCase().includes('daniel')
      );
      if (siriVoice) utterance.voice = siriVoice;
      utterance.pitch = 0.90;
      utterance.rate = 1.05;
      
      utterance.onstart = () => {
        this.aegisState = 'SPEAKING';
        this.updateStatus('Aegis transmitting vocal response...');
      };

      utterance.onend = () => {
        if (this.aegisState === 'SPEAKING') {
          this.aegisState = 'STANDBY';
          this.updateStatus('Aegis Neural Interface: Standby');
        }
      };

      utterance.onerror = (e) => {
        console.warn('Speech synthesis error:', e);
        if (this.aegisState === 'SPEAKING') {
          this.aegisState = 'STANDBY';
          this.updateStatus('Aegis Neural Interface: Standby');
        }
      };

      window.speechSynthesis.speak(utterance);
    } else {
      this.addDiagnosticLog('Speech synthesis is not supported on this device.', null, 'warning');
    }
  }

  private speakGreeting(text: string) {
    this.speakResponse(text);
  }

  private updateStatus(msg: string) {
    this.status = msg;
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private async submitCommandText(cmd: string) {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.aegisState = 'THINKING';
    this.currentAgentResponse = '';
    this.lastVoiceInteractionId = null;
    
    // Create messages in history
    const userMsgId = `user_${Date.now()}`;
    const userMsg = {
      role: 'user' as const,
      text: cmd,
      id: userMsgId,
      timestamp: new Date().toLocaleTimeString()
    };
    
    const modelMsgId = `model_${Date.now()}`;
    this.activeMessageId = modelMsgId;
    const modelMsg = {
      role: 'model' as const,
      text: '',
      id: modelMsgId,
      timestamp: new Date().toLocaleTimeString()
    };
    
    this.chatHistory = [...this.chatHistory, userMsg, modelMsg];
    this.requestUpdate();
    this.scrollToBottom();

    try {
      this.addDiagnosticLog(`📡 Transmitting text packet to Aegis Live: "${cmd}"`, null, 'info');
      this.playSoundEffect('click');
      
      if (!this.session) {
        throw new Error('Neural transmission channel disconnected.');
      }

      this.session.sendClientContent({
        turns: [
          {
            role: 'user',
            parts: [{ text: cmd }]
          }
        ],
        turnComplete: true
      });
      
    } catch (err: any) {
      console.error('Aegis Live query error:', err);
      this.addDiagnosticLog(`Failed to transmit text: ${err.message || err}`, null, 'error');
      this.aegisState = 'STANDBY';
      this.updateStatus('Aegis Neural Interface: Standby');
      
      this.chatHistory = this.chatHistory.map(msg => {
        if (msg.id === modelMsgId) {
          return { ...msg, text: `⚠️ Synaptic transmission error: ${err.message || 'Failed to connect'}` };
        }
        return msg;
      });
      this.requestUpdate();
    }
  }

  // Voice recording loops
  private handleToggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.playSoundEffect('activate');
    
    try {
      if (this.inputAudioContext.state === 'suspended') {
        await this.inputAudioContext.resume();
      }
      if (this.outputAudioContext.state === 'suspended') {
        await this.outputAudioContext.resume();
      }
      
      this.aegisState = 'LISTENING';
      this.updateStatus('Requesting microphone access...');

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Aegis capturing voice inputs...');
      this.addDiagnosticLog('🔵 Microphone stream engaged for real-time 3D visual analysis & live streaming.', null, 'success');

      // Connect source to inputNode so the 3D HUD can visualize the user's voice intensity
      this.sourceNode = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
      this.sourceNode.connect(this.inputNode);

      // Create ScriptProcessor to capture PCM chunks (sampleRate is 16kHz)
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.scriptProcessorNode.onaudioprocess = (e) => {
        if (!this.isRecording) return;
        const pcmFloat32 = e.inputBuffer.getChannelData(0);
        const blob = createBlob(pcmFloat32);
        if (this.session) {
          try {
            this.session.sendRealtimeInput({
              audio: {
                data: blob.data,
                mimeType: blob.mimeType
              }
            });
          } catch (err) {
            console.error('Failed to send audio chunk:', err);
          }
        }
      };

      this.isRecording = true;

    } catch (err: any) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.addDiagnosticLog(`Voice integration failed: ${err.message}`, null, 'error');
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording) {
      return;
    }

    this.playSoundEffect('click');
    this.updateStatus('Aegis core standing by...');
    this.isRecording = false;
    this.aegisState = 'STANDBY';

    if (this.scriptProcessorNode) {
      try {
        this.scriptProcessorNode.onaudioprocess = null;
        this.scriptProcessorNode.disconnect();
      } catch (e) {}
      this.scriptProcessorNode = null as any;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (e) {}
      this.sourceNode = null as any;
    }

    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((track) => track.stop());
      } catch (e) {}
      this.mediaStream = null as any;
    }

    this.addDiagnosticLog('Mic stream disengaged. Standby Mode.', null, 'info');
  }

  private reset() {
    this.playSoundEffect('boot');
    this.session?.close();
    this.initSession();
    this.addDiagnosticLog('⚠️ Aegis core soft-reboot complete. Neural pathways cleared.', null, 'warning');
  }

  private addDiagnosticLog(message: string, details?: any, type: string = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const log = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      timestamp,
      message,
      details: details ? JSON.stringify(details) : undefined,
      type
    };
    this.diagnosticLogs = [log, ...this.diagnosticLogs].slice(0, 50);
  }

  private loadVoiceInteractions() {
    try {
      const stored = localStorage.getItem('aegis_voice_history');
      if (stored) {
        this.voiceInteractions = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to load voice interactions from localStorage:', e);
    }
  }

  private saveVoiceInteractions() {
    try {
      localStorage.setItem('aegis_voice_history', JSON.stringify(this.voiceInteractions));
    } catch (e) {
      console.error('Failed to save voice interactions to localStorage:', e);
    }
  }

  private clearVoiceInteractions() {
    if (confirm('Are you sure you want to purge all logged voice telemetry?')) {
      this.voiceInteractions = [];
      try {
        localStorage.removeItem('aegis_voice_history');
        this.addDiagnosticLog('Voice history log purged.', null, 'warning');
      } catch (e) {
        console.error(e);
      }
      this.playSoundEffect('warning');
      this.requestUpdate();
    }
  }

  private deleteVoiceInteraction(id: string) {
    this.voiceInteractions = this.voiceInteractions.filter(vi => vi.id !== id);
    this.saveVoiceInteractions();
    this.addDiagnosticLog('Specific voice packet deleted from history.', null, 'info');
    this.playSoundEffect('click');
    this.requestUpdate();
  }

  private toggleHistoryPanel() {
    this.isHistoryOpen = !this.isHistoryOpen;
    this.playSoundEffect('click');
  }

  private loadPermissions() {
    try {
      const stored = localStorage.getItem('aegis_permissions');
      if (stored) {
        this.permissions = JSON.parse(stored);
        this.addDiagnosticLog('Loaded security permissions configuration from local storage.', null, 'success');
      }
    } catch (e) {
      console.error('Failed to load permissions from localStorage:', e);
    }
  }

  private savePermissions() {
    try {
      localStorage.setItem('aegis_permissions', JSON.stringify(this.permissions));
    } catch (e) {
      console.error('Failed to save permissions to localStorage:', e);
    }
  }

  private togglePermission(id: string) {
    let updatedPerm: AegisPermission | null = null;
    this.permissions = this.permissions.map(p => {
      if (p.id === id) {
        const newStatus = p.status === 'approved' ? 'revoked' : 'approved';
        updatedPerm = {
          ...p,
          status: newStatus,
          lastAccessed: new Date().toLocaleTimeString()
        };
        return updatedPerm;
      }
      return p;
    });

    this.savePermissions();

    if (updatedPerm) {
      const pName = (updatedPerm as AegisPermission).name;
      const pStatus = (updatedPerm as AegisPermission).status;
      this.addDiagnosticLog(`[SECURE SHIELD] ${pName} access ${pStatus.toUpperCase()}.`, null, pStatus === 'approved' ? 'success' : 'warning');
      this.playSoundEffect(pStatus === 'approved' ? 'success' : 'warning');

      if (this.session) {
        try {
          this.session.sendClientContent({
            turns: [{
              role: 'user',
              parts: [{
                text: `[SYSTEM: Security status updated. Access to ${pName} (id: ${id}) has been ${pStatus.toUpperCase()} by the user. Ensure your interactive capabilities respect this boundary immediately.]`
              }]
            }],
            turnComplete: true
          });
          this.addDiagnosticLog(`Synchronized updated boundary for ${pName} to active Aegis live session.`, null, 'info');
        } catch (err: any) {
          console.error('Failed to push permission change to live session:', err);
        }
      }
    }
    this.requestUpdate();
  }

  private setAllPermissions(status: 'approved' | 'revoked') {
    this.permissions = this.permissions.map(p => ({
      ...p,
      status: status,
      lastAccessed: new Date().toLocaleTimeString()
    }));
    this.savePermissions();

    this.addDiagnosticLog(`[SECURE SHIELD] Globally set ALL hardware and calendar accesses to ${status.toUpperCase()}.`, null, status === 'approved' ? 'success' : 'warning');
    this.playSoundEffect(status === 'approved' ? 'success' : 'warning');

    if (this.session) {
      try {
        this.session.sendClientContent({
          turns: [{
            role: 'user',
            parts: [{
              text: `[SYSTEM: Globally ${status === 'approved' ? 'APPROVED' : 'REVOKED'} all permissions for home hardware and calendar accounts. Adjust your behavior immediately and decline restricted actions.]`
            }]
          }],
          turnComplete: true
        });
      } catch (err: any) {
        console.error('Failed to sync global permission reset to live session:', err);
      }
    }
    this.requestUpdate();
  }

  private togglePermissionsPanel() {
    this.isPermissionsOpen = !this.isPermissionsOpen;
    this.playSoundEffect('click');
  }

  private loadUserLocation() {
    try {
      const stored = localStorage.getItem('aegis_user_location');
      if (stored) {
        this.userLocation = JSON.parse(stored);
        this.addDiagnosticLog('Loaded cached GPS telemetry from local cache.', null, 'success');
      }
    } catch (e) {
      console.error('Failed to load user location from localStorage:', e);
    }
  }

  private saveUserLocation() {
    try {
      if (this.userLocation) {
        localStorage.setItem('aegis_user_location', JSON.stringify(this.userLocation));
      } else {
        localStorage.removeItem('aegis_user_location');
      }
    } catch (e) {
      console.error('Failed to save user location to localStorage:', e);
    }
  }

  private requestUserLocation() {
    if (!navigator.geolocation) {
      this.locationError = 'Geolocation not supported by browser';
      this.addDiagnosticLog('Geolocation is not supported by this browser.', null, 'error');
      this.playSoundEffect('warning');
      return;
    }

    this.isLocating = true;
    this.locationError = null;
    this.addDiagnosticLog('Acquiring real-time GPS telemetry from browser sensor...', null, 'info');
    this.playSoundEffect('click');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        this.userLocation = {
          latitude: parseFloat(latitude.toFixed(5)),
          longitude: parseFloat(longitude.toFixed(5)),
          accuracy: Math.round(accuracy),
          timestamp: Date.now()
        };
        this.isLocating = false;
        this.saveUserLocation();
        this.addDiagnosticLog(`GPS Telemetry Lock: Lat ${this.userLocation.latitude}, Lon ${this.userLocation.longitude} (accuracy: ~${this.userLocation.accuracy}m)`, null, 'success');
        this.playSoundEffect('success');

        // If a session is currently active, transmit a real-time state payload to Aegis!
        if (this.session) {
          try {
            this.addDiagnosticLog('Synchronizing active GPS telemetry payload to Aegis live session...', null, 'info');
            this.session.sendClientContent({
              turns: [{
                role: 'user',
                parts: [{
                  text: `[SYSTEM: User has successfully verified and synchronized their real-time coordinates. Latitude: ${this.userLocation.latitude}, Longitude: ${this.userLocation.longitude}, Accuracy: ~${this.userLocation.accuracy} meters. Please acknowledge this update and feel free to use it if they ask for recommendations or location-based info.]`
                }]
              }],
              turnComplete: true
            });
          } catch (err: any) {
            console.error('Failed to push live GPS to session:', err);
          }
        }
        this.requestUpdate();
      },
      (error) => {
        this.isLocating = false;
        let errMsg = 'Failed to acquire location';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errMsg = 'Location permission denied by user';
            break;
          case error.POSITION_UNAVAILABLE:
            errMsg = 'Position information is unavailable';
            break;
          case error.TIMEOUT:
            errMsg = 'Location request timed out';
            break;
        }
        this.locationError = errMsg;
        this.addDiagnosticLog(`GPS Telemetry Error: ${errMsg}`, null, 'error');
        this.playSoundEffect('warning');
        this.requestUpdate();
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  }

  private clearUserLocation() {
    this.userLocation = null;
    this.locationError = null;
    this.saveUserLocation();
    this.addDiagnosticLog('GPS location cached data has been purged.', null, 'warning');
    this.playSoundEffect('warning');
    this.requestUpdate();
  }

  private handleTypedCommandSubmit(e: Event) {
    e.preventDefault();
    if (!this.typedCommand.trim()) return;
    
    const cmd = this.typedCommand;
    this.typedCommand = '';
    this.submitCommandText(cmd);
  }

  render() {
    return html`
      <!-- Custom styling and animation definitions -->
      <style>
        @keyframes pulse-blue {
          0%, 100% { transform: scale(1); opacity: 0.8; box-shadow: 0 0 10px rgba(59, 130, 246, 0.4); }
          50% { transform: scale(1.05); opacity: 1; box-shadow: 0 0 25px rgba(59, 130, 246, 0.8); }
        }
        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
        .glass-panel {
          background: rgba(10, 10, 12, 0.7);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05);
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.1);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 99px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        .aegis-container {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          background-color: #030303;
          user-select: none;
        }
      </style>

      <div class="aegis-container flex flex-col justify-between">
        
        <!-- 3D Orbit Layer in absolute background -->
        <div class="absolute inset-0 z-0">
          <gdm-live-audio-visuals-3d
            .inputNode=${this.inputNode}
            .outputNode=${this.outputNode}
            .aegisState=${this.aegisState}>
          </gdm-live-audio-visuals-3d>
          
          <!-- Subtle grid scanline effect -->
          <div class="absolute inset-0 opacity-5 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,_rgba(0,0,0,0.25)_50%),_linear-gradient(90deg,_rgba(255,0,0,0.06),_rgba(0,255,0,0.02),_rgba(0,0,255,0.06))] bg-[size:100%_4px,_6px_100%]"></div>
        </div>

        <!-- 1. BOOT DIALOG SCREEN -->
        ${!this.isBooted ? html`
          <div class="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/95 text-blue-400 font-mono p-8">
            <div class="w-full max-w-md p-6 rounded-xl border border-blue-500/25 bg-zinc-950/80 shadow-[0_0_30px_rgba(59,130,246,0.1)] relative overflow-hidden">
              <div class="absolute inset-x-0 h-1 bg-blue-500/20 top-0 pointer-events-none" style="animation: scanline 3s linear infinite;"></div>
              
              <div class="flex items-center gap-3 mb-6">
                <div class="w-3 h-3 rounded-full bg-blue-500 animate-ping"></div>
                <div class="text-xs uppercase tracking-widest text-zinc-500">System Boot Calibration</div>
              </div>
              <h1 class="text-2xl font-bold tracking-wider mb-2 text-white">Aegis AI Chatbot</h1>
              <div class="text-xs text-blue-500/80 mb-6 font-mono">NEURAL COGNITIVE CHANNEL V2.5</div>
              
              <div class="space-y-3 mb-6">
                <div class="flex justify-between text-xs">
                  <span class="text-zinc-400">Initializing Aegis Core:</span>
                  <span class="font-bold">${this.bootProgress}%</span>
                </div>
                <div class="w-full bg-zinc-900 h-2 rounded-full overflow-hidden p-[1px] border border-zinc-800">
                  <div class="bg-blue-500 h-full rounded-full transition-all duration-100" style="width: ${this.bootProgress}%"></div>
                </div>
              </div>

              <div class="h-24 overflow-hidden text-[10px] text-zinc-500 space-y-1 font-mono border-t border-zinc-900 pt-3">
                ${this.diagnosticLogs.slice(0, 3).map(log => html`
                  <div>[${log.timestamp}] ${log.message}</div>
                `)}
              </div>
            </div>
          </div>
        ` : ''}

        <!-- 2. TOP MENU BAR (HUD HEADER) -->
        <header class="w-full z-20 px-6 py-4 flex items-center justify-between border-b border-white/5 bg-black/60 backdrop-blur-md">
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center w-8 h-8 rounded-full border border-blue-500/40 text-blue-400 font-mono text-xs font-bold animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.2)]">
              A
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">Neural Cognitive Chatbot</div>
              <h1 class="text-sm font-bold tracking-wider text-white flex items-center gap-2">
                Aegis AI Chatbot <span class="text-[9px] bg-blue-950 border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded font-mono">Live Session</span>
              </h1>
            </div>
          </div>

          <div class="flex items-center gap-4 text-xs font-mono">
            <div class="px-3 py-1.5 rounded border border-zinc-800 bg-zinc-950/80 flex items-center gap-2">
              <span class="w-2 h-2 rounded-full ${this.aegisState !== 'STANDBY' ? 'bg-blue-500 animate-pulse' : 'bg-zinc-600'}"></span>
              <span class="text-zinc-400 uppercase tracking-widest text-[9px]">CORE:</span>
              <span class="${this.aegisState !== 'STANDBY' ? 'text-blue-400' : 'text-zinc-500'} font-bold">${this.aegisState}</span>
            </div>
            
            <!-- GPS Location Sensor Block -->
            <div class="flex items-center gap-1 pointer-events-auto">
              <button 
                @click=${this.requestUserLocation}
                ?disabled=${this.isLocating}
                class="px-3 py-1.5 rounded border transition-all duration-300 cursor-pointer flex items-center gap-1.5 text-[10px] tracking-widest uppercase ${
                  this.isLocating
                    ? 'border-amber-500/40 bg-amber-950/10 text-amber-400 animate-pulse'
                    : this.userLocation
                      ? 'border-emerald-500/40 bg-emerald-950/10 text-emerald-400 hover:border-emerald-500 hover:bg-emerald-950/30 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
                      : this.locationError
                        ? 'border-red-500/40 bg-red-950/10 text-red-400 hover:border-red-500 hover:bg-red-950/30'
                        : 'border-blue-500/20 hover:border-blue-500 bg-blue-950/10 hover:bg-blue-950/30 text-blue-400'
                }"
                title="${this.userLocation ? `GPS Lock: ${this.userLocation.latitude}, ${this.userLocation.longitude}. Click to re-calibrate GPS.` : 'Click to acquire real-time user GPS location coordinates'}">
                
                ${this.isLocating ? html`
                  <svg class="animate-spin h-3 w-3 text-amber-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Locking GPS...</span>
                ` : this.userLocation ? html`
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5 text-emerald-400">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                  </svg>
                  <span>GPS: ${this.userLocation.latitude}, ${this.userLocation.longitude}</span>
                ` : this.locationError ? html`
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5 text-red-400">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                  </svg>
                  <span>GPS Error</span>
                ` : html`
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5 text-blue-400">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                  </svg>
                  <span>Sync GPS</span>
                `}
              </button>
              
              ${this.userLocation ? html`
                <button 
                  @click=${this.clearUserLocation}
                  class="px-2 py-1.5 rounded border border-zinc-800 hover:border-red-500/40 bg-zinc-950/80 hover:bg-red-950/10 text-zinc-500 hover:text-red-400 text-[10px] transition-all duration-300 cursor-pointer"
                  title="Purge GPS Telemetry Memory Cache">
                  ✕
                </button>
              ` : ''}
            </div>

            <button 
              @click=${this.togglePermissionsPanel}
              class="px-3 py-1.5 rounded border ${this.isPermissionsOpen ? 'border-emerald-500 bg-emerald-950/25 text-emerald-400 font-bold' : 'border-blue-500/20 hover:border-emerald-500/50 bg-blue-950/10 hover:bg-emerald-950/10 text-blue-400 hover:text-emerald-400'} text-[10px] tracking-widest uppercase transition-all duration-300 cursor-pointer pointer-events-auto flex items-center gap-1.5"
              title="Manage hardware and calendar access permissions">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5 ${this.isPermissionsOpen ? 'animate-pulse' : ''}">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
              Permissions Hub (${this.permissions.filter(p => p.status === 'approved').length}/${this.permissions.length})
            </button>

            <button 
              @click=${this.toggleHistoryPanel}
              class="px-3 py-1.5 rounded border border-blue-500/20 hover:border-blue-500 bg-blue-950/10 hover:bg-blue-950/30 text-blue-400 text-[10px] tracking-widest uppercase transition-all duration-300 cursor-pointer pointer-events-auto flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              Voice History
            </button>

            <button 
              @click=${this.reset}
              class="px-3 py-1.5 rounded border border-red-500/20 hover:border-red-500 bg-red-950/10 hover:bg-red-950/30 text-red-400 text-[10px] tracking-widest uppercase transition-all duration-300 cursor-pointer pointer-events-auto">
              Reset Session
            </button>
          </div>
        </header>

        <!-- 3. CORE TWO-COLUMN CHAT & LOGS WORKSPACE -->
        <main class="w-full flex-1 grid grid-cols-12 gap-6 p-6 overflow-hidden z-10 pointer-events-none relative">
          
          <!-- LEFT SIDE: PRECISE CHAT ENGINE (Span 8) -->
          <div class="col-span-12 lg:col-span-8 flex flex-col h-full overflow-hidden pointer-events-auto">
            <div class="glass-panel rounded-2xl flex-1 flex flex-col overflow-hidden relative shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
              
              <!-- Chat Transcript Container -->
              <div id="chatContainer" class="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                ${this.chatHistory.map(msg => html`
                  <div class="flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="text-[9px] font-mono text-zinc-500">${msg.timestamp}</span>
                      <span class="text-[10px] font-mono uppercase tracking-wider font-bold ${msg.role === 'user' ? 'text-blue-400' : 'text-zinc-400'}">
                        ${msg.role === 'user' ? 'You' : 'Aegis'}
                      </span>
                    </div>
                    
                    <div class="max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                      msg.role === 'user' 
                        ? 'bg-zinc-800 text-white border border-white/5 rounded-tr-none' 
                        : msg.text 
                          ? 'bg-zinc-950/60 text-zinc-200 border border-white/5 rounded-tl-none' 
                          : 'bg-zinc-950/40 text-zinc-500 italic rounded-tl-none flex items-center gap-2 border border-white/5'
                    }">
                      ${msg.text ? msg.text : html`
                        <span class="inline-flex gap-1 items-center">
                          <span class="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
                          <span class="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
                          <span class="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
                        </span>
                        Aegis formulating response...
                      `}
                    </div>
                  </div>
                `)}
              </div>

              <!-- Real-time Voice Transcript Banner overlay -->
              ${this.currentTranscript ? html`
                <div class="absolute bottom-20 left-6 right-6 p-3 bg-blue-950/80 border border-blue-500/20 rounded-xl backdrop-blur-md text-center">
                  <div class="text-[9px] text-blue-400 uppercase tracking-widest mb-1 font-mono font-bold flex items-center justify-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping"></span>
                    Transcribing Voice Input
                  </div>
                  <p class="text-xs text-white italic font-mono">"${this.currentTranscript}"</p>
                </div>
              ` : ''}

              <!-- Typing & Controls Bar -->
              <div class="p-4 border-t border-white/5 bg-zinc-950/80 flex items-center gap-4">
                
                <!-- Circular Vocal Mic Button -->
                <button
                  id="toggleMicButton"
                  @click=${this.handleToggleRecording}
                  class="w-12 h-12 rounded-full border shrink-0 flex items-center justify-center cursor-pointer transition-all duration-300 pointer-events-auto ${
                    this.isRecording 
                      ? 'border-blue-500 bg-blue-950/40 hover:bg-blue-950/60 shadow-[0_0_15px_rgba(59,130,246,0.3)]' 
                      : 'border-white/10 bg-zinc-900/60 hover:border-blue-500/50 hover:bg-zinc-800'
                  }"
                  title="${this.isRecording ? 'Stop voice input' : 'Start voice input'}">
                  ${this.isRecording ? html`
                    <svg viewBox="0 0 100 100" class="w-5 h-5 fill-blue-400 animate-pulse" xmlns="http://www.w3.org/2000/svg">
                      <rect x="25" y="25" width="50" height="50" rx="6" />
                    </svg>
                  ` : html`
                    <svg viewBox="0 0 24 24" class="w-5 h-5 stroke-zinc-400" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                    </svg>
                  `}
                </button>

                <!-- Input Text Form -->
                <form @submit=${this.handleTypedCommandSubmit} class="flex-1 flex items-center gap-2">
                  <input 
                    type="text" 
                    .value=${this.typedCommand}
                    @input=${(e: any) => this.typedCommand = e.target.value}
                    placeholder="Speak, or type a message here..." 
                    class="flex-1 px-4 py-3 text-xs rounded-xl bg-zinc-900/50 border border-white/5 focus:border-blue-500 focus:outline-none text-zinc-100 font-mono transition-all placeholder:text-zinc-600 focus:bg-zinc-900"
                  />
                  <button 
                    type="submit"
                    class="py-3 px-5 rounded-xl bg-blue-950/40 hover:bg-blue-500 hover:text-black border border-blue-500/30 hover:border-blue-500 text-blue-400 font-mono text-xs font-bold tracking-wider transition-all duration-300 cursor-pointer">
                    Send
                  </button>
                </form>

              </div>
            </div>
          </div>

          <!-- RIGHT SIDE: LOGISTICS DIAGNOSTICS & SYSTEM STATUS (Span 4) -->
          <div class="col-span-12 lg:col-span-4 flex flex-col gap-6 h-full overflow-hidden pointer-events-auto">
            
            <!-- Real-time Signal Diagnostics Panel -->
            <div class="glass-panel p-5 rounded-2xl flex flex-col gap-4 overflow-hidden flex-1 shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
              <div class="flex items-center justify-between border-b border-white/5 pb-2">
                <h3 class="text-xs uppercase tracking-widest font-bold font-mono text-zinc-400 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 text-blue-400">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                  Operational Logs
                </h3>
                <span class="text-[9px] font-mono text-blue-500 bg-blue-950 px-1.5 py-0.5 border border-blue-500/20 rounded">Diagnostic Feed</span>
              </div>

              <!-- Terminal Diagnostic logs list -->
              <div class="flex-1 overflow-y-auto font-mono text-[10px] space-y-2 custom-scrollbar text-zinc-400 pr-1">
                ${this.diagnosticLogs.map(log => html`
                  <div class="flex items-start gap-2.5 hover:bg-white/5 p-1 rounded transition-all">
                    <span class="text-zinc-600 shrink-0">[${log.timestamp}]</span>
                    <span class="shrink-0 ${log.type === 'error' ? 'text-red-400' : log.type === 'warning' ? 'text-amber-400' : log.type === 'success' ? 'text-emerald-400' : 'text-blue-400'}">
                      ${log.type === 'error' ? '● ERR' : log.type === 'warning' ? '▲ WARN' : log.type === 'success' ? '■ COMP' : '⚙ INFO'}
                    </span>
                    <span class="flex-1 text-zinc-300 break-words leading-relaxed">
                      ${log.message}
                      ${log.details ? html`<span class="text-[9px] text-zinc-500 block bg-black/40 p-1 rounded mt-1 font-mono border border-white/5 overflow-x-auto">${log.details}</span>` : ''}
                    </span>
                  </div>
                `)}
              </div>
            </div>

          </div>
        </main>

        <!-- FOOTER: Simple Minimalist Signature -->
        <footer class="w-full z-10 px-6 py-3 border-t border-white/5 bg-black/70 backdrop-blur-md flex justify-between items-center text-[10px] font-mono text-zinc-500 pointer-events-auto">
          <div>Powered by Aegis AI Chatbot</div>
          <div>All channels secure & responsive</div>
        </footer>

        <!-- Side Panel Backdrop Overlay -->
        ${this.isHistoryOpen ? html`
          <div 
            class="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300 pointer-events-auto"
            @click=${this.toggleHistoryPanel}>
          </div>
        ` : ''}

        <!-- Permissions Panel Backdrop Overlay -->
        ${this.isPermissionsOpen ? html`
          <div 
            class="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300 pointer-events-auto"
            @click=${this.togglePermissionsPanel}>
          </div>
        ` : ''}

        <!-- Permissions Panel Sidebar -->
        <div class="fixed top-0 bottom-0 right-0 w-full max-w-md bg-zinc-950/95 border-l border-white/10 z-50 transition-transform duration-300 ease-in-out transform ${this.isPermissionsOpen ? 'translate-x-0' : 'translate-x-full'} flex flex-col pointer-events-auto shadow-[0_0_50px_rgba(0,0,0,0.8)]">
          
          <!-- Header -->
          <div class="p-6 border-b border-white/5 flex items-center justify-between bg-zinc-900/50">
            <div class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-emerald-400">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
              <div>
                <h2 class="text-sm font-bold tracking-wider text-white font-mono uppercase">Permissions Hub</h2>
                <p class="text-[9px] text-zinc-500 font-mono font-bold uppercase tracking-widest">Interface Gateways</p>
              </div>
            </div>

            <button 
              @click=${this.togglePermissionsPanel}
              class="text-zinc-400 hover:text-white transition-colors cursor-pointer"
              title="Close Panel">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Body Container -->
          <div class="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
            
            <!-- Health & Quick Actions Card -->
            <div class="p-4 rounded-xl border border-white/5 bg-zinc-900/20 space-y-4">
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">Interface Integrity</div>
                  <div class="text-xs font-mono font-bold text-white mt-0.5 flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full ${this.permissions.filter(p => p.status === 'approved').length > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}"></span>
                    ${this.permissions.filter(p => p.status === 'approved').length} of ${this.permissions.length} Gateways Online
                  </div>
                </div>
                <!-- Dynamic progress bar -->
                <div class="w-24 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                  <div class="bg-emerald-500 h-1.5 rounded-full transition-all duration-500" style="width: ${(this.permissions.filter(p => p.status === 'approved').length / this.permissions.length) * 100}%"></div>
                </div>
              </div>

              <!-- Quick Actions Grid -->
              <div class="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
                <button 
                  @click=${() => this.setAllPermissions('approved')}
                  class="py-1.5 rounded bg-emerald-950/20 hover:bg-emerald-950/40 border border-emerald-500/20 hover:border-emerald-500/40 text-emerald-400 text-[10px] font-mono uppercase tracking-wider transition-all cursor-pointer">
                  Authorize All
                </button>
                <button 
                  @click=${() => this.setAllPermissions('revoked')}
                  class="py-1.5 rounded bg-red-950/10 hover:bg-red-950/30 border border-red-500/20 hover:border-red-500/40 text-red-400 text-[10px] font-mono uppercase tracking-wider transition-all cursor-pointer">
                  Block All
                </button>
              </div>
            </div>

            <!-- Tabs Selector -->
            <div class="flex items-center p-1 rounded-lg bg-zinc-900/60 border border-white/5 font-mono text-[10px]">
              <button 
                @click=${() => this.activePermissionCategory = 'all'}
                class="flex-1 py-1.5 text-center rounded transition-all cursor-pointer ${this.activePermissionCategory === 'all' ? 'bg-blue-500 text-black font-bold font-mono' : 'text-zinc-400 hover:text-white'}"
                style="outline: none;">
                ALL
              </button>
              <button 
                @click=${() => this.activePermissionCategory = 'hardware'}
                class="flex-1 py-1.5 text-center rounded transition-all cursor-pointer ${this.activePermissionCategory === 'hardware' ? 'bg-blue-500 text-black font-bold font-mono' : 'text-zinc-400 hover:text-white'}"
                style="outline: none;">
                HARDWARE
              </button>
              <button 
                @click=${() => this.activePermissionCategory = 'calendar'}
                class="flex-1 py-1.5 text-center rounded transition-all cursor-pointer ${this.activePermissionCategory === 'calendar' ? 'bg-blue-500 text-black font-bold font-mono' : 'text-zinc-400 hover:text-white'}"
                style="outline: none;">
                CALENDARS
              </button>
            </div>

            <!-- Permissions Gate List -->
            <div class="space-y-3.5">
              ${this.permissions
                .filter(p => this.activePermissionCategory === 'all' || p.category === this.activePermissionCategory)
                .map(p => html`
                  <div class="p-4 rounded-xl border transition-all duration-300 ${
                    p.status === 'approved' 
                      ? 'border-emerald-500/15 bg-emerald-950/5 shadow-[inset_0_1px_0_rgba(16,185,129,0.05)]' 
                      : 'border-white/5 bg-zinc-900/10'
                  }">
                    <div class="flex items-start justify-between gap-4">
                      
                      <!-- Icon + Title + Info -->
                      <div class="flex items-start gap-3">
                        <div class="p-2 rounded-lg border shrink-0 mt-0.5 ${
                          p.status === 'approved' 
                            ? 'border-emerald-500/25 bg-emerald-950/20 text-emerald-400' 
                            : 'border-white/5 bg-zinc-900/40 text-zinc-500'
                        }">
                          ${p.id === 'smart_lights' ? html`
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707-.707M12 7a5 5 0 100 10 5 5 0 000-10z" />
                            </svg>
                          ` : p.id === 'thermostat' ? html`
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                          ` : p.id === 'smart_lock' ? html`
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                          ` : p.id === 'security_camera' ? html`
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          ` : html`
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          `}
                        </div>
                        
                        <div class="space-y-0.5">
                          <h4 class="text-xs font-mono font-bold text-white flex flex-wrap items-center gap-2">
                            ${p.name}
                            <span class="text-[8px] px-1.5 py-0.2 rounded font-mono border ${
                              p.category === 'hardware' 
                                ? 'border-amber-500/25 bg-amber-950/10 text-amber-400' 
                                : 'border-blue-500/25 bg-blue-950/10 text-blue-400'
                            }">
                              ${p.category.toUpperCase()}
                            </span>
                          </h4>
                          <p class="text-[10px] text-zinc-400 leading-relaxed font-sans">${p.description}</p>
                        </div>
                      </div>

                      <!-- Flip Switch Toggle Control -->
                      <button 
                        @click=${() => this.togglePermission(p.id)}
                        class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          p.status === 'approved' ? 'bg-emerald-500' : 'bg-zinc-800'
                        }"
                        style="outline: none;">
                        <span class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          p.status === 'approved' ? 'translate-x-5' : 'translate-x-0'
                        }"></span>
                      </button>

                    </div>

                    <!-- Telemetry audit footer inside card -->
                    <div class="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between text-[8.5px] font-mono text-zinc-500">
                      <div class="flex items-center gap-1">
                        <span class="w-1 h-1 rounded-full ${p.status === 'approved' ? 'bg-emerald-500 animate-ping' : 'bg-zinc-600'}"></span>
                        Gate State: <span class="${p.status === 'approved' ? 'text-emerald-400 font-bold' : 'text-zinc-500'}">${p.status.toUpperCase()}</span>
                      </div>
                      <div>
                        Last Action: <span class="text-zinc-400 font-mono">${p.lastAccessed}</span>
                      </div>
                    </div>

                  </div>
                `)}
            </div>

          </div>

          <!-- Panel Footer -->
          <div class="p-4 border-t border-white/5 bg-zinc-900/20 text-center text-[9px] font-mono text-zinc-600">
            Aegis Cryptographic Shield Gateway v3.1
          </div>
        </div>

        <!-- Side Panel Container -->
        <div class="fixed top-0 bottom-0 right-0 w-full max-w-md bg-zinc-950/95 border-l border-white/10 z-50 transition-transform duration-300 ease-in-out transform ${this.isHistoryOpen ? 'translate-x-0' : 'translate-x-full'} flex flex-col pointer-events-auto shadow-[0_0_50px_rgba(0,0,0,0.8)]">
          
          <!-- Header -->
          <div class="p-6 border-b border-white/5 flex items-center justify-between bg-zinc-900/50">
            <div class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-blue-400 animate-pulse">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <div>
                <h2 class="text-sm font-bold tracking-wider text-white font-mono uppercase">Voice Telemetry History</h2>
                <p class="text-[9px] text-zinc-500 font-mono">Logged previous vocal packets</p>
              </div>
            </div>

            <div class="flex items-center gap-3">
              ${this.voiceInteractions.length > 0 ? html`
                <button 
                  @click=${this.clearVoiceInteractions}
                  class="px-2.5 py-1 text-[9px] font-mono rounded border border-red-500/20 hover:border-red-500 bg-red-950/10 hover:bg-red-950/30 text-red-400 transition-all duration-300 cursor-pointer">
                  Purge Logs
                </button>
              ` : ''}
              <button 
                @click=${this.toggleHistoryPanel}
                class="text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="Close Panel">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Body Scrollable List -->
          <div class="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            ${this.voiceInteractions.length === 0 ? html`
              <div class="h-full flex flex-col items-center justify-center text-center p-4">
                <div class="w-16 h-16 rounded-full border border-zinc-800 bg-zinc-900/30 flex items-center justify-center mb-4 text-zinc-600 animate-pulse">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                  </svg>
                </div>
                <h3 class="text-xs font-bold text-zinc-400 font-mono uppercase tracking-wider mb-1">No Vocal Telemetry Logged</h3>
                <p class="text-[10px] text-zinc-600 font-mono max-w-xs">Activate voice channels and speak to log real-time audio transcript packets for system diagnostics.</p>
              </div>
            ` : this.voiceInteractions.map(vi => html`
              <div class="p-4 rounded-xl border border-white/5 bg-zinc-900/30 relative group hover:border-blue-500/20 hover:bg-zinc-900/50 transition-all duration-300">
                
                <!-- Delete individual interaction item -->
                <button 
                  @click=${() => this.deleteVoiceInteraction(vi.id)}
                  class="absolute top-3 right-3 text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                  title="Delete this record">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>

                <!-- Timestamp -->
                <div class="text-[9px] font-mono text-zinc-500 mb-3 flex items-center gap-1.5 border-b border-white/5 pb-2">
                  <span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                  ${vi.timestamp}
                </div>

                <!-- Dialog Pairs -->
                <div class="space-y-3.5">
                  <!-- User Speech -->
                  <div class="space-y-1">
                    <div class="flex items-center gap-1.5 text-[9px] font-mono text-blue-400 uppercase tracking-wider font-bold">
                      <span class="w-1 h-1 rounded-full bg-blue-400 animate-pulse"></span>
                      You (Vocal packet)
                    </div>
                    <p class="text-xs text-white bg-zinc-950/40 border border-white/5 p-2.5 rounded-lg font-mono break-words leading-relaxed">
                      "${vi.userText}"
                    </p>
                  </div>

                  <!-- Agent Reply -->
                  ${vi.agentText ? html`
                    <div class="space-y-1">
                      <div class="flex items-center gap-1.5 text-[9px] font-mono text-zinc-400 uppercase tracking-wider font-bold">
                        <span class="w-1 h-1 rounded-full bg-zinc-400"></span>
                        Aegis (Vocal reply)
                      </div>
                      <p class="text-xs text-zinc-300 bg-zinc-950/20 border border-white/5 p-2.5 rounded-lg font-mono break-words leading-relaxed">
                        ${vi.agentText}
                      </p>
                    </div>
                  ` : html`
                    <div class="text-[10px] text-zinc-600 italic font-mono flex items-center gap-1.5">
                      <span class="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-ping"></span>
                      Vocal reply streaming...
                    </div>
                  `}
                </div>

              </div>
            `)}
          </div>

          <!-- Panel Footer -->
          <div class="p-4 border-t border-white/5 bg-zinc-900/20 text-center text-[9px] font-mono text-zinc-600">
            Aegis Cryptographic Memory Logs — Local Cache
          </div>
        </div>

      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-live-audio': GdmLiveAudio;
  }
}
