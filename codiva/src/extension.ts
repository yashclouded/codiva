import { queryObjects } from 'v8';
import * as vscode from 'vscode';

type DayRecord = { 
  added: number; 
  removed: number; 
  touched?: boolean;
  languages: Record<string, number>; // tracks lines per language coded
  sessions: number; // Coding sessions
  timeSpent: number; // Minutes spent coding
  commits?: number; // Git commits
};

type Badge = { 
  id: string; 
  level: number; 
  unlockedAt: Date;
  progress?: number; // Progress to next level
};

type Achievement = {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: 'streak' | 'productivity' | 'mastery' | 'social' | 'special';
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'champion';
  unlockedAt?: Date;
  progress: number; 
  target: number;
};

type WeeklyChallenge = {
  id: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  type: 'lines' | 'streak' | 'languages' | 'time' | 'flow';
  weekStart: string; // ISO date
  completed: boolean;
  reward: number; // XP reward
};

type CodingSession = {
  start: Date;
  end?: Date;
  lines: number;
  language: string;
  files: string[];
  flowMetrics?: {
    interruptions: number; // Number of gaps > 2 minutes
    fileSwitches: number; // Number of different files worked on
    typingBursts: number; // Number of continuous typing periods
    longestBurst: number; // Longest uninterrupted period (minutes)
    averageGapTime: number; // Average time between edits (seconds)
    flowScore: number; // Calculated flow score (0-100)
  };
};

type PomodoroSession = {
  id: string;
  start: Date;
  end?: Date;
  duration: number; // minutes (25, 15, 5)
  type: 'work' | 'shortBreak' | 'longBreak';
  completed: boolean;
  interrupted?: boolean;
  task?: string; // Optional task description
  remainingSeconds?: number;
  state?: 'running' | 'paused' | 'completed' | 'stopped';
  pausedAt?: Date;
};

type PomodoroStats = {
  totalSessions: number;
  completedSessions: number;
  totalWorkTime: number; // minutes
  totalBreakTime: number; // minutes
  longestStreak: number; // consecutive completed sessions
  currentStreak: number;
  todaySessions: number;
  weekSessions: number;
  averageSessionsPerDay: number;
  lastSessionDate?: Date;
};

type CelebrationEvent = {
  type: 'lines100' | 'streakMilestone' | 'pomodoro' | 'languageUnlock';
  message: string;
  effect?: 'confetti' | 'pulse';
  highlightSelector?: string;
  detail?: Record<string, unknown>;
};


type ImprovementSnapshot = {
  last14Days: Array<{ date: string; lines: number; timeSpent: number; sessions: number }>;
  weekComparison: {
    currentLines: number;
    previousLines: number;
    linesDelta: number;
    linesPercent: number;
    currentTime: number;
    previousTime: number;
    timeDelta: number;
    timePercent: number;
    currentSessions: number;
    previousSessions: number;
    sessionDelta: number;
    sessionPercent: number;
  };
  pomodoroComparison: {
    currentWork: number;
    previousWork: number;
    delta: number;
    percent: number;
  };
  bestDay?: {
    date: string;
    lines: number;
  };
};

type CodivaStats = {
  // User Profile
  userName?: string;
  isFirstTime?: boolean;
  
  // Core stats for gamification

  manualLines: number;
  xp: number;
  totalXp: number;
  level: number;
  streak: number;
  maxStreak: number;
  lastCoded: Date | null;
  
  // Legacy
  achievements: string[];
  deletedLines: number;
  
  badges: Badge[];
  newAchievements: Achievement[];
  weeklyChallenge?: WeeklyChallenge;
  history: Record<string, DayRecord>;
  languageStats: Record<string, { lines: number; sessions: number; timeSpent: number }>;
  projectStats: Record<string, { lines: number; sessions: number; timeSpent: number; languages: string[]; lastWorked: Date; files: Set<string> }>;
  currentProject?: string; // Currently active project
  totalSessions: number;
  totalTimeSpent: number; // minutes
  averageSessionLength: number; // minutes
  currentSession?: CodingSession;
  

  // Anti-spam tracking
  lastChangeTime?: number; // timestamp
  recentChanges: { timestamp: number; content: string; file: string }[]; // last 10 changes
  
  //gamification of the program
  consecutiveDays: number;
  weeklyGoal: number;
  dailyGoal: number;
  perfectWeeks: number; // Weeks where daily goal was met every day
  longestSession: number; // minutes
  favoriteLanguage: string;
  
  
  //Analytics


  mostProductiveHour: number; // 0-23
  codingDays: number; // Total unique days coded
  averageXpPerDay: number;
  
  // Pomodoro tracking
  pomodoroStats: PomodoroStats;
  pomodoroHistory: PomodoroSession[];
  currentPomodoro?: PomodoroSession;
};
const LANGUAGE_NAME_MAP: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  typescriptreact: 'TypeScript React',
  javascriptreact: 'JavaScript React',
  jsx: 'JSX',
  tsx: 'TSX',
  python: 'Python',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  go: 'Go',
  ruby: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  kotlin: 'Kotlin',
  rust: 'Rust',
  dart: 'Dart',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sass: 'Sass',
  less: 'Less',
  json: 'JSON',
  yaml: 'YAML',
  markdown: 'Markdown'
};

let statusBarItem: vscode.StatusBarItem;
let stats: CodivaStats;

let pomodoroTimer: NodeJS.Timeout | undefined;
let pomodoroRemainingSeconds: number | undefined;
let pomodoroStatusBarItem: vscode.StatusBarItem;
let dashboardPanel: vscode.WebviewPanel | undefined;
let dashboardReady = false;
const celebrationQueue: CelebrationEvent[] = [];

// Flow tracking variables
let sessionEditTimestamps: number[] = [];
let sessionFileSet: Set<string> = new Set();

function getFlowTips(flowMetrics: NonNullable<CodingSession['flowMetrics']>): string {
  const tips: string[] = [];
  
  if (flowMetrics.flowScore >= 90) {
    tips.push('🎉 <strong>Excellent flow!</strong> You\'re in the zone!');
  } else if (flowMetrics.flowScore >= 70) {
    tips.push('✨ <strong>Good flow!</strong> Keep up the focused work.');
  } else if (flowMetrics.flowScore >= 50) {
    tips.push('📈 <strong>Improving flow.</strong> Try reducing interruptions.');
  } else {
    tips.push('<strong>Focus opportunity.</strong> Try longer uninterrupted periods.');
  }

  if (flowMetrics.interruptions > 3) {
    tips.push('💡 <strong>Tip:</strong> Try turning off notifications for deeper focus.');
  }
  
  if (flowMetrics.fileSwitches > 5) {
    tips.push('💡 <strong>Tip:</strong> Consider focusing on fewer files at once.');
  }
  
  if (flowMetrics.longestBurst < 10) {
    tips.push('💡 <strong>Tip:</strong> Aim for longer uninterrupted coding periods.');
  }
  
  if (flowMetrics.averageGapTime > 60) {
    tips.push('💡 <strong>Tip:</strong> Try to maintain consistent typing rhythm.');
  }

  return tips.length > 0 ? `<div class="flow-tip">${tips.join('</div><div class="flow-tip">')}</div>` : '';
}

function calculateFlowMetrics(session: CodingSession, editTimestamps: number[], fileSet: Set<string>) {
  const sessionDuration = session.end 
    ? (session.end.getTime() - session.start.getTime()) / (1000 * 60) // minutes
    : 0;
  
  if (sessionDuration < 5 || editTimestamps.length < 3) {
    // Too short or too few edits for meaningful flow analysis
    return {
      interruptions: 0,
      fileSwitches: Math.max(0, fileSet.size - 1),
      typingBursts: 0,
      longestBurst: 0,
      averageGapTime: 0,
      flowScore: 0
    };
  }

  // Calculate gaps between edits (in seconds)
  const gaps: number[] = [];
  for (let i = 1; i < editTimestamps.length; i++) {
    gaps.push((editTimestamps[i] - editTimestamps[i - 1]) / 1000);
  }

  const interruptions = gaps.filter(gap => gap > 120).length;
  
  let typingBursts = 0;
  let currentBurstStart = 0;
  let longestBurst = 0;
  
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i] > 30) { // End of burst
      if (i > currentBurstStart) {
        typingBursts++;
        const burstDuration = (editTimestamps[i] - editTimestamps[currentBurstStart]) / (1000 * 60);
        longestBurst = Math.max(longestBurst, burstDuration);
      }
      currentBurstStart = i + 1;
    }
  }
  


  if (editTimestamps.length - 1 > currentBurstStart) {
    typingBursts++;
    const burstDuration = (editTimestamps[editTimestamps.length - 1] - editTimestamps[currentBurstStart]) / (1000 * 60);
    longestBurst = Math.max(longestBurst, burstDuration);
  }

  const averageGapTime = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const fileSwitches = Math.max(0, fileSet.size - 1);

  // Calculate flow score (out of 100)
  let flowScore = 50; // Base score
  
  // Penalty for interruptions (each interruption -10 points)
  flowScore -= Math.max(50, interruptions * 10);
  
  // Penalty for excessive file switching (-5 points per switch beyond 2)
  flowScore -= Math.max(0, (fileSwitches - 2) * 5);
  
  // Bonus for longer bursts (+20 points if longest burst > 15 min)
  if (longestBurst > 15) flowScore += 20;
  else if (longestBurst > 5) flowScore += 10;
  
  // Bonus for consistent typing (low average gap time)
  if (averageGapTime < 10) flowScore += 15;
  else if (averageGapTime < 30) flowScore += 5;
  
  // Bonus for session length
  if (sessionDuration > 60) flowScore += 15;
  else if (sessionDuration > 30) flowScore += 10;

  return {
    interruptions,
    fileSwitches,
    typingBursts,
    longestBurst: Math.round(longestBurst * 10) / 10, // Round to 1 decimal
    averageGapTime: Math.round(averageGapTime * 10) / 10,
    flowScore: Math.max(0, Math.min(100, Math.round(flowScore)))
  };
}

function getReadableLanguageName(languageId: string): string {
  if (!languageId) return 'Unknown';
  const key = languageId.toLowerCase();
  if (LANGUAGE_NAME_MAP[key]) {
    return LANGUAGE_NAME_MAP[key];
  }
  const spaced = key.replace(/[-_]/g, ' ');
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function sanitizeLanguageBadgeId(languageId: string): string {
  return `language-${languageId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function queueCelebration(event: CelebrationEvent) {
  celebrationQueue.push(event);
  if (celebrationQueue.length > 25) {
    celebrationQueue.shift();
  }
  dispatchCelebrations();
}

function dispatchCelebrations() {
  if (!dashboardReady || !dashboardPanel || celebrationQueue.length === 0) {
    return;
  }

  const events = celebrationQueue.splice(0);
  dashboardPanel.webview.postMessage({ type: 'celebrations', events });
}

function handleFirstLanguageUnlock(languageId: string, now: Date) {
  const badgeId = sanitizeLanguageBadgeId(languageId);

  stats.badges = stats.badges ?? [];
  const alreadyUnlocked = stats.badges.some((badge) => badge.id === badgeId);
  if (alreadyUnlocked) {
    return;
  }

  const displayName = getReadableLanguageName(languageId);
  const bonusXp = 100;

  stats.badges.push({ id: badgeId, level: 1, unlockedAt: now });
  stats.xp += bonusXp;
  stats.totalXp += bonusXp;

  stats.newAchievements = stats.newAchievements ?? [];
  stats.newAchievements.unshift({
    id: `${badgeId}-${now.getTime()}`,
    title: `${displayName} Explorer`,
    description: `You wrote your first ${displayName} line!`,
    icon: 'polyglot',
    category: 'special',
    rarity: 'common',
    unlockedAt: now,
    progress: 100,
    target: 1
  });
  if (stats.newAchievements.length > 20) {
    stats.newAchievements = stats.newAchievements.slice(0, 20);
  }

  queueCelebration({
    type: 'languageUnlock',
    message: `🌟 First ${displayName} lines! +${bonusXp} XP`,
    effect: 'confetti',
    highlightSelector: '#topLanguagesCard',
    detail: { language: displayName, bonusXp }
  });

  vscode.window.setStatusBarMessage(`Codiva: ${displayName} Explorer unlocked! +${bonusXp} XP`, 4000);
}

export function activate(context: vscode.ExtensionContext) {
  stats = loadStats(context);

  if (stats.currentPomodoro && stats.currentPomodoro.remainingSeconds !== undefined) {
    pomodoroRemainingSeconds = stats.currentPomodoro.remainingSeconds;
  }

  // Handle first-time user onboarding
  if (stats.isFirstTime) {
    // Delay to let VS Code fully load
    setTimeout(() => handleFirstTimeUser(context, stats), 1000);
  }

  // Status bar setup of the VS Code extension
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'codiva.showDashboard';
  context.subscriptions.push(statusBarItem);
  updateStatusBar();


  // Enhanced tracking with language detection and session management

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      try {
        let validAdded = 0;
        let removed = 0;
        
        // Safety check for document and changes
        if (!e || !e.contentChanges || !e.document) {
          return;
        }
        
        // Process each change with anti-spam validation
        for (const change of e.contentChanges) {
          try {
            const txt = change.text ?? '';
            
            // Count removed lines with safety checks
            if (change.range && change.range.end && change.range.start) {
              removed += Math.max(0, change.range.end.line - change.range.start.line);
            }
            
            // Validate and count added lines only if content is meaningful
            if (txt.length > 0) {
              const addedLines = txt.split('\n').length - 1;
              
              // Anti-spam validation
              if (addedLines > 0 && isValidCodeChange(txt, e.document.fileName, stats)) {
                validAdded += addedLines;
                updateRecentChanges(stats, txt, e.document.fileName);
              }
            }
          } catch (changeError) {
            console.error('Codiva: Error processing individual change:', changeError);
            continue;
          }
        }

        // Only proceed if we have valid changes in the document
        if (validAdded === 0 && removed === 0) return;

        const now = new Date();
        const key = toDateKey(now);
        const language = e.document.languageId || 'unknown';
        
        // Initialize daily record with enhanced structure
        const rec: DayRecord = stats.history[key] ?? { 
          added: 0, 
          removed: 0, 
          languages: {}, 
          sessions: 0, 
          timeSpent: 0 
        };
        const previousDailyLines = rec.added;
        const wasLanguageTracked = !!stats.languageStats[language];
        
        if (validAdded > 0) {
          stats.manualLines += validAdded;
          stats.xp += validAdded * 10;
          stats.totalXp += validAdded * 10;
          rec.added += validAdded;

          if (previousDailyLines < 100 && rec.added >= 100) {
            queueCelebration({
              type: 'lines100',
              message: `🔥 100 lines today! (${rec.added} total)`,
              effect: 'confetti',
              highlightSelector: '#xpProgressFill',
              detail: { totalLinesToday: rec.added }
            });
          }
          
          // Track language-specific stats
          rec.languages[language] = (rec.languages[language] || 0) + validAdded;
          if (!stats.languageStats[language]) {
            stats.languageStats[language] = { lines: 0, sessions: 0, timeSpent: 0 };
          }
          stats.languageStats[language].lines += validAdded;

          if (!wasLanguageTracked) {
            handleFirstLanguageUnlock(language, now);
          }
          
          // Track project-specific stats
          const projectName = extractProjectName(e.document.fileName);
          stats.currentProject = projectName;
          if (!stats.projectStats[projectName]) {
            stats.projectStats[projectName] = { 
              lines: 0, 
              sessions: 0, 
              timeSpent: 0, 
              languages: [], 
              lastWorked: now,
              files: new Set()
            };
          }
          stats.projectStats[projectName].lines += validAdded;
          stats.projectStats[projectName].lastWorked = now;
          stats.projectStats[projectName].files.add(e.document.fileName);
          if (!stats.projectStats[projectName].languages.includes(language)) {
            stats.projectStats[projectName].languages.push(language);
          }
          
          // Update the favorite language
          const topLang = Object.entries(stats.languageStats)
            .sort(([,a], [,b]) => b.lines - a.lines)[0];
          if (topLang) stats.favoriteLanguage = topLang[0];
        }


        
        if (removed > 0) {
          stats.deletedLines += removed;
          rec.removed += removed;
        }

        
        if (validAdded === 0 && removed === 0) rec.touched = true;
        
        
        // Session management in the program
        // Start a new session if none exists or if last edit was >30 min ago


        if (!stats.currentSession || 
            (now.getTime() - stats.currentSession.start.getTime()) > 30 * 60 * 1000) { // 30 min gap = new session
          if (stats.currentSession) {
            stats.currentSession.end = now;
            const sessionLength = (stats.currentSession.end.getTime() - stats.currentSession.start.getTime()) / (1000 * 60);
            
            // Calculate flow metrics before ending session
            stats.currentSession.flowMetrics = calculateFlowMetrics(stats.currentSession, sessionEditTimestamps, sessionFileSet);
            
            stats.totalTimeSpent += sessionLength;
            stats.longestSession = Math.max(stats.longestSession, sessionLength);
            rec.timeSpent += sessionLength;
            rec.sessions++;
            stats.totalSessions++;
            
            if (stats.languageStats[stats.currentSession.language]) {
              stats.languageStats[stats.currentSession.language].timeSpent += sessionLength;
              stats.languageStats[stats.currentSession.language].sessions++;
            }
            
            // Update project session stats
            const sessionProject = extractProjectName(stats.currentSession.files[0] || '');
            if (stats.projectStats[sessionProject]) {
              stats.projectStats[sessionProject].timeSpent += sessionLength;
              stats.projectStats[sessionProject].sessions++;
            }
          }
          
          // Reset flow tracking for new session
          sessionEditTimestamps = [now.getTime()];
          sessionFileSet = new Set([e.document.fileName]);
          
          stats.currentSession = {
            start: now,
            lines: validAdded,
            language,
            files: [e.document.fileName]
          };
        } else {
          // Track edits for flow analysis
          sessionEditTimestamps.push(now.getTime());
          sessionFileSet.add(e.document.fileName);
          
          // Keep only last 100 timestamps to prevent memory issues
          if (sessionEditTimestamps.length > 100) {
            sessionEditTimestamps = sessionEditTimestamps.slice(-100);
          }
          
          stats.currentSession.lines += validAdded;
          if (!stats.currentSession.files.includes(e.document.fileName)) {
            stats.currentSession.files.push(e.document.fileName);
          }
        }
        
        // Update analytics
        const hour = now.getHours();
        if (!stats.mostProductiveHour || validAdded > 0) {
          // Simple heuristic: most recent active hour becomes most productive
          stats.mostProductiveHour = hour;
        }
        
        stats.history[key] = rec;
        stats.lastCoded = now;

        let needed = stats.level * 100;
        while (stats.xp >= needed) {
          stats.xp -= needed;
          stats.level += 1;
          needed = stats.level * 100;
        }

        const previousStreak = stats.streak;
        // Streak from history
    
        stats.streak = computeConsecutiveStreak(stats.history);
        stats.maxStreak = Math.max(stats.maxStreak, stats.streak);

        const streakMilestones = [3, 7, 14, 30, 100];
        const justHitMilestone = streakMilestones.find((milestone) => previousStreak < milestone && stats.streak >= milestone);
        if (justHitMilestone) {
          queueCelebration({
            type: 'streakMilestone',
            message: `🔥 ${stats.streak}-day streak! Keep it going!`,
            effect: 'confetti',
            highlightSelector: '#streakHeadline',
            detail: { streak: stats.streak }
          });
        }

        // Update analytics
        stats.codingDays = Object.keys(stats.history).length;
        stats.averageXpPerDay = stats.codingDays > 0 ? stats.totalXp / stats.codingDays : 0;
        stats.averageSessionLength = stats.totalSessions > 0 ? stats.totalTimeSpent / stats.totalSessions : 0;

        // Enhanced achievements and challenges
        updateAchievements(stats);
        updateWeeklyChallenge(stats);
        evaluateAchievements(stats, now);
        
        // Smart notifications
        checkDailyGoal(stats);
        checkStreakReminders(stats, now);

        updateStatusBar();
        saveStats(context, stats);
        
      } catch (error) {
        console.error('Codiva: Error in text document change handler:', error);
        // Don't show user error for every keystroke, just log it
      }
    })
  );

  // Dashboard command
  const showDashboard = vscode.commands.registerCommand('codiva.showDashboard', () => {
    const panel = vscode.window.createWebviewPanel(
      'codivaDashboard',
      'Codiva Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    dashboardPanel = panel;
    dashboardReady = false;

    const imgLevelUp = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'resources', 'level_up.png'));
    const imgMedal = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'resources', 'medal.png'));
    const imgStar = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'resources', 'star.png'));
    const imgFlame = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'resources', 'flame.png'));
    const imgCheck = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'resources', 'checkmark.png'));
    // Pre-resolve each achievement icon to a webview URI so we don't concatenate folder URIs (which breaks)
    const achievementIconFiles = [
      'first-step','streak-warrior','streak-legend','weekend-warrior','early-bird','midnight-hacker','bug-hunter','polyglot','master-builder','perfectionist'
    ];
    const achievementIconMap: Record<string,string> = {};
    for (const f of achievementIconFiles) {
      achievementIconMap[f] = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'resources', 'achievements', `${f}.png`)).toString();
    }

    const render = () => {
      panel.webview.html = getWebviewContent(
        stats,
        { imgLevelUp: imgLevelUp.toString(), imgMedal: imgMedal.toString(), imgStar: imgStar.toString(), imgFlame: imgFlame.toString(), imgCheck: imgCheck.toString(), achievementIcons: achievementIconMap }
      );
    };
    render();

    panel.onDidDispose(() => {
      if (dashboardPanel === panel) {
        dashboardPanel = undefined;
      }
      dashboardReady = false;
    });

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === 'ready') {
        dashboardReady = true;
        dispatchCelebrations();
        panel.webview.postMessage({ type: 'themeChanged' });
        return;
      }

      if (msg?.type === 'reset') {
        vscode.commands.executeCommand('codiva.resetStats').then(() => render());
      } else if (msg?.type === 'export') {
        const exportData = {
          stats,
          exportDate: new Date().toISOString(),
          version: '2.0'
        };
        vscode.env.clipboard.writeText(JSON.stringify(exportData, null, 2));
        vscode.window.showInformationMessage('Stats exported to clipboard!');
      } else if (msg?.type === 'changeName') {
        const newName = await vscode.window.showInputBox({
          prompt: '✏️ What should we call you?',
          value: stats.userName || '',
          placeHolder: 'Enter your new name',
          validateInput: (value) => {
            if (!value || value.trim().length === 0) {
              return 'Please enter a name';
            }
            if (value.trim().length > 50) {
              return 'Name is too long (max 50 characters)';
            }
            if (!/^[a-zA-Z0-9\s\-_]+$/.test(value.trim())) {
              return 'Name can only contain letters, numbers, spaces, hyphens, and underscores';
            }
            return null;
          }
        });
        
        if (newName && newName.trim()) {
          stats.userName = newName.trim();
          saveStats(context, stats);
          render();
          vscode.window.showInformationMessage(`Hello, ${stats.userName}! Your name has been updated.`);
        }
      } else if (msg?.command === 'startPomodoro') {
        vscode.commands.executeCommand('codiva.startPomodoro');
      } else if (msg?.command === 'startShortBreak') {
        vscode.commands.executeCommand('codiva.startShortBreak');
      } else if (msg?.command === 'startLongBreak') {
        vscode.commands.executeCommand('codiva.startLongBreak');
      } else if (msg?.command === 'pausePomodoro') {
        vscode.commands.executeCommand('codiva.pausePomodoro');
      } else if (msg?.command === 'resumePomodoro') {
        vscode.commands.executeCommand('codiva.resumePomodoro');
      } else if (msg?.command === 'stopPomodoro') {
        vscode.commands.executeCommand('codiva.stopPomodoro');
      } else if (msg?.type === 'openProject') {
        // Handle opening a project
        const projectName = msg.projectName;
        const filePath = msg.filePath;
        
        if (filePath) {
          // Try to open the file if it exists
          try {
            const uri = vscode.Uri.file(filePath);
            await vscode.window.showTextDocument(uri);
            vscode.window.showInformationMessage(`Opened ${projectName} project`);
          } catch (error) {
            // If file doesn't exist, try to open the project directory
            try {
              const projectPath = filePath.substring(0, filePath.lastIndexOf('/'));
              const uri = vscode.Uri.file(projectPath);
              await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
            } catch (dirError) {
              vscode.window.showErrorMessage(`Could not open project ${projectName}`);
            }
          }
        } else {
          vscode.window.showInformationMessage(`Project: ${projectName} (no files to open)`);
        }
      }
    });
  });
  context.subscriptions.push(showDashboard);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      if (dashboardPanel) {
        dashboardPanel.webview.postMessage({ type: 'themeChanged' });
      }
    })
  );





  // Internal commands
  const getStatsCmd = vscode.commands.registerCommand('codiva.getStats', () => {
    return {
      manualLines: stats.manualLines,
      xp: stats.xp,
      level: stats.level,
      streak: stats.streak,
      achievements: [...stats.achievements],
      badges: stats.badges ?? [],
      lastCoded: stats.lastCoded ? stats.lastCoded.getTime() : null
    } as const;
  });
  context.subscriptions.push(getStatsCmd);

  const resetCmd = vscode.commands.registerCommand('codiva.resetStats', () => {
    stats = createDefaultStats();
    updateStatusBar();
    saveStats(context, stats);
  });
  context.subscriptions.push(resetCmd);

  // Pomodoro Commands
  const startPomodoroCmd = vscode.commands.registerCommand('codiva.startPomodoro', async () => {
    await startPomodoro(context, 'work', 25);
  });
  context.subscriptions.push(startPomodoroCmd);

  const startShortBreakCmd = vscode.commands.registerCommand('codiva.startShortBreak', async () => {
    await startPomodoro(context, 'shortBreak', 5);
  });
  context.subscriptions.push(startShortBreakCmd);

  const startLongBreakCmd = vscode.commands.registerCommand('codiva.startLongBreak', async () => {
    await startPomodoro(context, 'longBreak', 15);
  });
  context.subscriptions.push(startLongBreakCmd);

  const pausePomodoroCmd = vscode.commands.registerCommand('codiva.pausePomodoro', async () => {
    await pausePomodoro(context);
  });
  context.subscriptions.push(pausePomodoroCmd);

  const resumePomodoroCmd = vscode.commands.registerCommand('codiva.resumePomodoro', async () => {
    await resumePomodoro(context);
  });
  context.subscriptions.push(resumePomodoroCmd);

  const stopPomodoroCmd = vscode.commands.registerCommand('codiva.stopPomodoro', async () => {
    await stopPomodoro(context);
  });
  context.subscriptions.push(stopPomodoroCmd);

  // Pomodoro status bar setup
  pomodoroStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  pomodoroStatusBarItem.command = 'codiva.startPomodoro';
  context.subscriptions.push(pomodoroStatusBarItem);
  updatePomodoroStatusBar();
}

function updateStatusBar() {
  try {
    if (!statusBarItem || !stats) {
      console.warn('Codiva: Status bar or stats not initialized');
      return;
    }
    
    const needed = Math.max(1, stats.level * 100); // Prevent division by zero
    const streak = Math.max(0, stats.streak || 0);
    const level = Math.max(1, stats.level || 1);
    const xp = Math.max(0, stats.xp || 0);
    
    statusBarItem.text = `$(flame) ${streak}  $(star) L${level} ${xp}/${needed}`;
    statusBarItem.tooltip = new vscode.MarkdownString(
      `Codiva\n\n- Manual lines: ${stats.manualLines || 0}\n- Deleted lines: ${stats.deletedLines || 0}\n- Streak: ${streak} day${streak === 1 ? '' : 's'}\n- Level: ${level}`
    );
    statusBarItem.show();
  } catch (error) {
    console.error('Codiva: Error updating status bar:', error);
    try {
      statusBarItem.text = `$(flame) Codiva`;
      statusBarItem.tooltip = 'Codiva - Click to open dashboard';
      statusBarItem.show();
    } catch (fallbackError) {
      console.error('Codiva: Critical error with status bar:', fallbackError);
    }
  }
}

function getWebviewContent(
  stats: CodivaStats,
  imgs: { imgLevelUp: string; imgMedal: string; imgStar: string; imgFlame: string; imgCheck: string; achievementIcons: Record<string,string> }
) {
  const xpNeeded = stats.level * 100;
  const xpProgress = Math.max(0, Math.min(100, Number(((stats.xp / xpNeeded) * 100).toFixed(2))));
  const heatmapData = generateHeatmapData(stats.history);
  const challengeProgress = stats.weeklyChallenge ? Math.min(100, (stats.weeklyChallenge.progress / stats.weeklyChallenge.target) * 100) : 0;
  const improvementSnapshot = computeImprovementSnapshot(stats);
  
  // Generate heatmap grid with detailed tooltips
  const heatmapHTML = heatmapData.slice(-91).map((day, i) => {
    const opacity = day.level === 0 ? 0.1 : 0.2 + (day.level * 0.2);
    const record = stats.history[day.date];
    const timeSpent = record?.timeSpent || 0;
    const sessions = record?.sessions || 0;
    const languages = record?.languages ? Object.keys(record.languages).length : 0;
    const removedLines = record?.removed || 0;
    
    // Format time spent
    const formatTime = (minutes: number): string => {
      if (minutes === 0) return '0 min';
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      if (hours > 0) {
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
      }
      return `${mins}m`;
    };
    
    // Format date for display
    const displayDate = new Date(day.date + 'T00:00:00').toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });
    
    // Create detailed tooltip
    const tooltip = day.count === 0 
      ? `${displayDate}: No coding activity`
      : `${displayDate}
${day.count} lines coded${removedLines > 0 ? ` (+${day.count} -${removedLines})` : ''}
${formatTime(timeSpent)} coding time
${sessions} session${sessions !== 1 ? 's' : ''}${languages > 0 ? `
${languages} language${languages !== 1 ? 's' : ''}` : ''}`;
    
    return `<div class="heat-day" data-tooltip="${tooltip.replace(/"/g, '&quot;')}" style="background-color: rgba(34, 197, 94, ${opacity})"></div>`;
  }).join('');

  // Recent achievements (unlocked in last 7 days)
  const recentAchievements = stats.newAchievements
    ?.filter(a => a.unlockedAt && new Date().getTime() - new Date(a.unlockedAt).getTime() < 7 * 24 * 60 * 60 * 1000)
    ?.slice(0, 3) || [];

  // Top languages
  const topLanguages = Object.entries(stats.languageStats || {})
    .sort(([,a], [,b]) => b.lines - a.lines)
    .slice(0, 5);

  // Top projects
  const topProjects = Object.entries(stats.projectStats || {})
    .sort(([,a], [,b]) => b.timeSpent - a.timeSpent)
    .slice(0, 5)
    .map(([name, data]) => ({
      name,
      timeSpent: data.timeSpent,
      lines: data.lines,
      sessions: data.sessions,
      languages: data.languages || [],
      files: data.files ? Array.from(data.files) : [],
      lastWorked: data.lastWorked,
      topLanguage: data.languages && data.languages.length > 0 ? data.languages[0] : 'unknown'
    }));

  // Map achievement icon ids to available file names (handles naming mismatches)
  const mapIcon = (id: string): string => {
    switch (id) {
      case 'first-steps': return 'first-step'; // provided asset is singular
      case 'weekend-grinder': return 'weekend-warrior'; // reuse weekend-warrior if grinder missing
      default: return id; // others match directly if asset exists
    }
  };
  const achievementsForWeb = (stats.newAchievements || []).map(a => ({ ...a, iconFile: mapIcon(a.icon) }));

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Codiva Dashboard</title>
    <style>
      :root { 
        color-scheme: var(--vscode-color-scheme, dark);
        --bg: var(--vscode-editor-background, #0d1117); 
        --bg-secondary: var(--vscode-sideBar-background, #161b22); 
        --card: var(--vscode-sideBarSectionHeader-background, #21262d); 
        --border: var(--vscode-panel-border, #30363d);
        --accent: var(--vscode-charts-green, var(--vscode-button-background, #238636)); 
        --accent-hover: var(--vscode-button-hoverBackground, #2ea043);
        --accent-secondary: var(--vscode-charts-blue, #1f6feb); 
        --text: var(--vscode-foreground, #f0f6fc); 
        --text-secondary: var(--vscode-descriptionForeground, #8b949e); 
        --danger: var(--vscode-inputValidation-errorBorder, #f85149);
        --warning: var(--vscode-inputValidation-warningBorder, #d29922);
        --success: var(--vscode-testing-iconPassed, #3fb950);
        --purple: #a5a5f5;
        --accent-rgb: 34, 197, 94;
      }
      
      * { box-sizing: border-box; margin: 0; padding: 0; }
      
      body { 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
        background: var(--bg); 
        color: var(--text); 
        line-height: 1.5;
        overflow-x: hidden;
      }
      
      .container { max-width: 1200px; margin: 0 auto; padding: 24px; }

      #celebration-container {
        position: fixed;
        top: 16px;
        right: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        z-index: 2500;
        pointer-events: none;
      }

      .celebration-toast {
        background: color-mix(in srgb, var(--card) 85%, transparent);
        color: var(--text);
        border-left: 4px solid var(--accent);
        border-radius: 12px;
        padding: 12px 16px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
        transform: translateX(130%);
        opacity: 0;
        transition: transform 0.3s ease, opacity 0.3s ease;
        pointer-events: auto;
        font-weight: 600;
        letter-spacing: 0.1px;
      }

      .celebration-toast.visible {
        transform: translateX(0);
        opacity: 1;
      }

      #confetti-layer {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 0;
        overflow: visible;
        pointer-events: none;
        z-index: 2400;
      }

      .confetti-piece {
        position: absolute;
        top: -20px;
        width: 10px;
        height: 14px;
        border-radius: 2px;
        opacity: 0;
        transform: translate3d(0, 0, 0) rotateZ(0deg);
        animation: confettiFall 1.4s ease-out forwards;
      }

      @keyframes confettiFall {
        0% { opacity: 0; transform: translate3d(0, -20vh, 0) rotateZ(0deg); }
        10% { opacity: 1; }
        100% { opacity: 0; transform: translate3d(calc(var(--drift, 0) * 1px), 120vh, 0) rotateZ(720deg); }
      }

      .celebration-highlight {
        animation: celebrationHighlight 1.4s ease-out;
        box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0.45), 0 0 18px rgba(var(--accent-rgb), 0.35);
        border-radius: 8px;
      }

      @keyframes celebrationHighlight {
        0% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0.6), 0 0 18px rgba(var(--accent-rgb), 0.35); }
        60% { box-shadow: 0 0 0 16px rgba(var(--accent-rgb), 0), 0 0 24px rgba(var(--accent-rgb), 0.25); }
        100% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0), 0 0 0 rgba(var(--accent-rgb), 0); }
      }

      .celebration-scale {
        animation: celebrationScale 0.6s ease-in-out;
      }

      @keyframes celebrationScale {
        0% { transform: scale(1); }
        50% { transform: scale(1.03); }
        100% { transform: scale(1); }
      }
      
      .header { 
        display: flex; 
        align-items: center; 
        gap: 16px; 
        margin-bottom: 32px; 
        padding: 20px;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 12px;
      }
      
      .header img { width: 48px; height: 48px; border-radius: 50%; }
      
      .header-content h1 { 
        font-size: 28px; 
        font-weight: 600; 
        color: var(--text);
        margin-bottom: 4px;
      }
      
      .header-subtitle { 
        color: var(--text-secondary); 
        font-size: 16px;
      }
      
      .grid { 
        display: grid; 
        grid-template-columns: 2fr 1fr; 
        gap: 24px; 
        margin-bottom: 24px;
      }
      
      @media (max-width: 768px) {
        .grid { grid-template-columns: 1fr; }
      }
      
      .card { 
        background: var(--card); 
        border: 1px solid var(--border); 
        border-radius: 12px; 
        padding: 20px;
        transition: border-color 0.2s;
      }
      
      .card:hover { border-color: var(--accent); }
      
      .card-header { 
        display: flex; 
        align-items: center; 
        justify-content: space-between; 
        margin-bottom: 16px; 
      }
      
      .card-title { 
        font-size: 18px; 
        font-weight: 600; 
        color: var(--text);
      }
      
      .stats-grid { 
        display: grid; 
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); 
        gap: 16px; 
        margin-bottom: 24px;
      }
      
      .stat-card { 
        background: var(--bg-secondary); 
        padding: 16px; 
        border-radius: 8px; 
        text-align: center;
        border: 1px solid var(--border);
      }
      
      .stat-value { 
        font-size: 32px; 
        font-weight: 700; 
        color: var(--accent);
        display: block;
      }
      
      .stat-label { 
        color: var(--text-secondary); 
        font-size: 14px; 
        text-transform: uppercase; 
        letter-spacing: 0.5px;
        margin-top: 4px;
      }
      
      .progress-container { 
        background: var(--bg-secondary); 
        border-radius: 8px; 
        padding: 20px; 
        margin-bottom: 20px;
      }
      
      .progress-header { 
        display: flex; 
        justify-content: space-between; 
        align-items: center; 
        margin-bottom: 12px;
      }
      
      .progress-bar { 
        width: 100%; 
        height: 12px; 
        background: var(--border); 
        border-radius: 6px; 
        overflow: hidden;
      }
      
      .progress-fill { 
        height: 100%; 
        background: linear-gradient(90deg, var(--accent) 0%, color-mix(in srgb, var(--accent-secondary) 65%, var(--accent) 35%) 100%); 
        border-radius: 6px; 
        transition: width 0.3s ease;
      }
      
      .heatmap-container { margin: 20px 0; }
      
      .heatmap { 
        display: grid; 
        grid-template-columns: repeat(13, 1fr); 
        gap: 3px; 
        margin-top: 12px;
      }
      
      .heat-day { 
        width: 12px; 
        height: 12px; 
        border-radius: 2px; 
        background: rgba(34, 197, 94, 0.1);
        transition: all 0.2s;
        cursor: pointer;
        position: relative;
      }
      
      .heat-day:hover { 
        transform: scale(1.2); 
        border: 1px solid var(--accent);
        z-index: 10;
      }
      
      /* Enhanced tooltip styling */
      .heat-day[data-tooltip]:hover::after {
        content: attr(data-tooltip);
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        background: var(--card);
        color: var(--text);
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 12px;
        line-height: 1.4;
        white-space: pre-line;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        border: 1px solid var(--border);
        z-index: 1000;
        pointer-events: none;
        max-width: 200px;
        margin-bottom: 8px;
      }
      
      .heat-day[data-tooltip]:hover::before {
        content: '';
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 5px solid transparent;
        border-top-color: var(--card);
        z-index: 1000;
        margin-bottom: 3px;
      }
      
      .achievements-grid { 
        display: grid; 
        gap: 12px; 
      }
      
      .achievement { 
        display: flex; 
        align-items: center; 
        gap: 12px; 
        padding: 12px; 
        background: var(--bg-secondary); 
        border-radius: 8px; 
        border: 1px solid var(--border);
        transition: all 0.2s;
      }
      
      .achievement:hover { 
        border-color: var(--accent); 
        transform: translateY(-1px);
      }
      
      .achievement-icon { 
        font-size: 24px; 
        width: 40px; 
        height: 40px; 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        background: var(--card); 
        border-radius: 50%;
      }
      
      .achievement-icon-img {
        width: 24px;
        height: 24px;
        object-fit: contain;
      }
      
      .status-icon {
        width: 16px;
        height: 16px;
        object-fit: contain;
      }
      
      .user-achievement-icon {
        width: 16px;
        height: 16px;
        object-fit: contain;
        margin-left: 4px;
        vertical-align: middle;
        filter: drop-shadow(0 0 2px rgba(255, 215, 0, 0.8));
      }
      
      .star-count {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-left: 8px;
        color: #ffd700;
        font-weight: 600;
        font-size: 16px;
        text-shadow: 0 0 4px rgba(255, 215, 0, 0.5);
      }
      
      .star-count img {
        width: 16px;
        height: 16px;
        filter: drop-shadow(0 0 2px rgba(255, 215, 0, 0.8));
      }
      
      .achievement-content { flex: 1; }
      
      .achievement-title { 
        font-weight: 600; 
        color: var(--text); 
        margin-bottom: 2px;
      }
      
      .achievement-desc { 
        color: var(--text-secondary); 
        font-size: 14px;
      }
      
      .achievement-progress { 
        width: 60px; 
        height: 4px; 
        background: var(--border); 
        border-radius: 2px; 
        overflow: hidden;
        margin-top: 4px;
      }
      
      .achievement-progress-fill { 
        height: 100%; 
        background: var(--accent); 
        border-radius: 2px;
      }
      
      .language-item { 
        display: flex; 
        justify-content: space-between; 
        align-items: center; 
        padding: 8px 0; 
        border-bottom: 1px solid var(--border);
      }
      
      .language-item:last-child { border-bottom: none; }
      
      .project-item {
        border-bottom: 1px solid var(--border);
        padding: 12px 0;
      }
      
      .project-item:last-child { border-bottom: none; }
      
      .project-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
        user-select: none;
      }
      
      .project-info {
        flex: 1;
      }
      
      .project-name {
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: 4px;
      }
      
      .project-stats {
        font-size: 12px;
        color: var(--text-secondary);
      }
      
      .project-chevron {
        font-size: 12px;
        color: var(--text-secondary);
        transition: transform 0.2s ease;
      }
      
      .project-item.expanded .project-chevron {
        transform: rotate(180deg);
      }
      
      .project-details {
        margin-top: 12px;
        padding: 12px;
        background: var(--card-bg);
        border-radius: 6px;
        border: 1px solid var(--border);
      }
      
      .project-detail-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 0;
      }
      
      .detail-label {
        font-size: 12px;
        color: var(--text-secondary);
      }
      
      .detail-value {
        font-size: 12px;
        color: var(--text-primary);
        font-weight: 500;
      }
      
      .open-project-btn {
        width: 100%;
        margin-top: 12px;
        padding: 8px 12px;
        background: var(--accent);
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: background-color 0.2s ease;
      }
      
      .open-project-btn:hover {
        background: var(--accent-hover);
      }
      
      .language-name { font-weight: 500; }
      
      .language-lines { 
        color: var(--text-secondary); 
        font-size: 14px;
      }
      
      .challenge-card { 
        background: linear-gradient(135deg, var(--accent-secondary), var(--purple)); 
        color: white; 
        border: none;
      }
      
      .challenge-title { 
        font-size: 20px; 
        font-weight: 700; 
        margin-bottom: 8px;
      }
      
      .challenge-desc { 
        opacity: 0.9; 
        margin-bottom: 16px;
      }
      
      /* Flow Analysis Styles */
      .flow-score {
        font-weight: 700;
        font-size: 18px;
        padding: 4px 12px;
        border-radius: 16px;
      }
      
      .flow-excellent {
        background: rgba(63, 185, 80, 0.2);
        color: var(--success);
        border: 1px solid var(--success);
      }
      
      .flow-good {
        background: rgba(255, 193, 7, 0.2);
        color: #ffc107;
        border: 1px solid #ffc107;
      }
      
      .flow-improving {
        background: rgba(248, 81, 73, 0.2);
        color: var(--danger);
        border: 1px solid var(--danger);
      }
      
      .flow-no-data {
        background: var(--bg-secondary);
        color: var(--text-secondary);
        border: 1px solid var(--border);
      }
      
      .flow-metrics {
        margin: 16px 0;
      }
      
      .flow-tips {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--border);
      }
      
      .flow-tip {
        background: rgba(var(--accent-rgb), 0.1);
        border-left: 3px solid var(--accent);
        padding: 8px 12px;
        margin: 8px 0;
        border-radius: 4px;
        font-size: 14px;
        line-height: 1.4;
      }
      
      .actions { 
        display: flex; 
        gap: 12px; 
        margin-top: 20px;
      }
      
      .btn { 
        padding: 10px 16px; 
        border: none; 
        border-radius: 6px; 
        font-weight: 600; 
        cursor: pointer; 
        transition: all 0.2s;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      
      .btn-primary { 
        background: var(--accent); 
        color: white;
      }
      
      .btn-primary:hover { 
        background: var(--accent-hover); 
        transform: translateY(-1px);
      }
      
      .btn-secondary { 
        background: var(--bg-secondary); 
        color: var(--text); 
        border: 1px solid var(--border);
      }
      
      .btn-secondary:hover { 
        border-color: var(--accent); 
      }
      
      .btn-danger { 
        background: #d73a49;
        color: white;
        border: 1px solid #d73a49;
      }
      
      .btn-danger:hover { 
        background: #b31d28;
        border-color: #b31d28;
      }
      
      .streak-flame { 
        color: #ff6b35; 
        animation: flicker 2s infinite alternate;
      }
      
      @keyframes flicker { 
        0% { opacity: 1; } 
        100% { opacity: 0.8; } 
      }
      
      .level-badge { 
        background: linear-gradient(45deg, var(--accent), var(--success)); 
        color: white; 
        padding: 4px 12px; 
        border-radius: 20px; 
        font-size: 14px; 
        font-weight: 600;
      }

      .trend-positive { color: var(--success); }
      .trend-negative { color: var(--danger); }
      .trend-neutral { color: var(--text-secondary); }

      .improvement-body {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .improvement-chart {
        position: relative;
        width: 100%;
        height: 148px;
        background: color-mix(in srgb, var(--bg-secondary) 90%, transparent);
        border: 1px solid var(--border);
        border-radius: 12px;
        overflow: hidden;
        padding: 18px 16px 28px;
      }

      .improvement-chart svg {
        width: 100%;
        height: 100%;
      }

      .improvement-chart-grid {
        position: absolute;
        inset: 12px;
        background-image: linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px),
                          linear-gradient(to top, rgba(255,255,255,0.04) 1px, transparent 1px);
        background-size: calc(100% / 6) calc(100% / 4);
        pointer-events: none;
      }

      .improvement-chart-label {
        position: absolute;
        left: 16px;
        top: 14px;
        font-size: 12px;
        color: var(--text-secondary);
        background: rgba(0, 0, 0, 0.2);
        padding: 2px 8px;
        border-radius: 999px;
        pointer-events: none;
      }

      .improvement-metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px;
      }

      .improvement-metric {
        background: color-mix(in srgb, var(--bg-secondary) 92%, transparent);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .metric-title {
        font-size: 12px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--text-secondary);
      }

      .metric-value {
        font-size: 20px;
        font-weight: 600;
        color: var(--text);
      }

      .metric-delta {
        font-size: 13px;
        font-weight: 500;
      }

      .best-day-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        background: rgba(var(--accent-rgb), 0.1);
        border-radius: 999px;
        font-size: 12px;
        color: var(--accent);
        width: fit-content;
      }

      .improvement-tooltip {
        position: absolute;
        background: rgba(15, 23, 42, 0.92);
        color: var(--text);
        font-size: 12px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid rgba(var(--accent-rgb), 0.35);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        pointer-events: none;
        z-index: 5;
        transform: translate(-50%, -100%);
        transition: opacity 0.1s ease;
      }

      .improvement-tooltip strong {
        display: block;
        margin-bottom: 2px;
        font-size: 12px;
        font-weight: 600;
        color: var(--text);
      }

      .spark-point {
        fill: var(--accent);
        opacity: 0.35;
        transition: opacity 0.15s ease, r 0.15s ease;
        pointer-events: none;
      }

      .spark-point-active {
        opacity: 1;
      }
      
      .rarity-common { border-left: 4px solid #6b7280; }
      .rarity-rare { border-left: 4px solid #3b82f6; }
      .rarity-epic { border-left: 4px solid #8b5cf6; }
      .rarity-legendary { border-left: 4px solid #f59e0b; }
      
      .gallery-item {
        transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
      }
      
      .gallery-item img {
        transition: filter 0.3s ease, transform 0.2s ease;
      }
      
      .gallery-item:hover {
        transform: translateY(-2px);
        border-color: var(--accent) !important;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      }
      
      /* Hover effects for locked achievements (make them colorful) */
      .gallery-item:not(.unlocked):hover img {
        filter: brightness(1.3) saturate(1.8) drop-shadow(0 0 8px rgba(34, 197, 94, 0.6)) !important;
        transform: scale(1.1);
      }
      
      /* Hover effects for unlocked achievements (enhance them further) */
      .gallery-item.unlocked:hover img {
        filter: brightness(1.2) saturate(1.3) drop-shadow(0 0 12px rgba(255, 215, 0, 0.8)) !important;
        transform: scale(1.15);
      }
      
      .gallery-item.clickable {
        border: 2px solid var(--border);
      }
      
      .gallery-item.clickable:hover {
        border-color: var(--accent);
      }
      
      /* Achievement Modal */
      .modal {
        display: none;
        position: fixed;
        z-index: 1000;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        animation: fadeIn 0.3s ease;
      }
      
      .modal-content {
        background-color: var(--bg);
        margin: 10% auto;
        padding: 20px;
        border: 1px solid var(--border);
        border-radius: 8px;
        width: 80%;
        max-width: 500px;
        position: relative;
        animation: slideIn 0.3s ease;
      }
      
      .modal-close {
        color: var(--text-secondary);
        float: right;
        font-size: 28px;
        font-weight: bold;
        cursor: pointer;
        line-height: 1;
      }
      
      .modal-close:hover {
        color: var(--text);
      }
      
      .modal-achievement {
        text-align: center;
        padding: 20px 0;
      }
      
      .modal-achievement-icon {
        width: 80px;
        height: 80px;
        margin: 0 auto 16px;
        border-radius: 50%;
        background: var(--card);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .modal-achievement-icon img {
        width: 48px;
        height: 48px;
        object-fit: contain;
      }
      
      .modal-achievement-title {
        font-size: 24px;
        font-weight: 700;
        color: var(--text);
        margin-bottom: 8px;
      }
      
      .modal-achievement-desc {
        color: var(--text-secondary);
        margin-bottom: 16px;
      }
      
      .modal-progress-section {
        margin: 20px 0;
        text-align: left;
      }
      
      .modal-progress-bar {
        width: 100%;
        height: 12px;
        background: var(--border);
        border-radius: 6px;
        overflow: hidden;
        margin: 8px 0;
      }
      
      .modal-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--accent) 0%, color-mix(in srgb, var(--accent-secondary) 65%, var(--accent) 35%) 100%);
        transition: width 0.3s ease;
      }
      
      .modal-tips {
        background: var(--bg-secondary);
        border-radius: 8px;
        padding: 16px;
        margin-top: 16px;
      }
      
      .modal-tips h4 {
        margin: 0 0 8px 0;
        color: var(--text);
        font-size: 16px;
      }
      
      .modal-tips p {
        margin: 0;
        color: var(--text-secondary);
        font-size: 14px;
        line-height: 1.4;
      }
      
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      @keyframes slideIn {
        from { transform: translateY(-30px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    </style>
  </head>
  <body>
    <div id="celebration-container" aria-live="polite"></div>
    <div id="confetti-layer" aria-hidden="true"></div>
    <div class="container">
      <!-- Header -->
      <div class="header">
        <img src="${imgs.imgLevelUp}" alt="Avatar" />
        <div class="header-content">
          <h1>Welcome back, ${stats.userName || 'Developer'}! <span class="star-count" title="Stars earned from achievements - shows your coding skill level"><img src="${imgs.imgStar}" alt="Star" />${stats.newAchievements?.filter(a => a.unlockedAt).length || 0}</span></h1>
          <div class="header-subtitle" id="streakHeadline">
            Level ${stats.level} Developer • ${stats.streak} day streak <span class="streak-flame"><img src="${imgs.imgFlame}" alt="Streak" class="status-icon" /></span>
          </div>
        </div>
        <div class="level-badge">Level ${stats.level}</div>
      </div>

      <!-- Main Grid -->
      <div class="grid">
        <!-- Left Column -->
        <div>
          <!-- Stats Overview -->
          <div class="stats-grid">
            <div class="stat-card">
              <span class="stat-value">${stats.totalXp.toLocaleString()}</span>
              <div class="stat-label">Total XP</div>
            </div>
            <div class="stat-card">
              <span class="stat-value" style="color: #ffd700;">${stats.newAchievements?.filter(a => a.unlockedAt).length || 0} ⭐</span>
              <div class="stat-label">Stars Earned</div>
            </div>
            <div class="stat-card">
              <span class="stat-value">${stats.manualLines.toLocaleString()}</span>
              <div class="stat-label">Lines Coded</div>
            </div>
            <div class="stat-card">
              <span class="stat-value">${stats.maxStreak}</span>
              <div class="stat-label">Best Streak</div>
            </div>
            <div class="stat-card">
              <span class="stat-value">${Object.keys(stats.languageStats || {}).length}</span>
              <div class="stat-label">Languages</div>
            </div>
            <div class="stat-card">
              <span class="stat-value">${stats.pomodoroStats?.completedSessions || 0}</span>
              <div class="stat-label">🍅 Pomodoros</div>
            </div>
            <div class="stat-card">
              <span class="stat-value">${Math.floor((stats.pomodoroStats?.totalWorkTime || 0) / 60)}h</span>
              <div class="stat-label">Focus Time</div>
            </div>
          </div>

          <!-- XP Progress -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Level Progress</div>
              <span>${stats.xp}/${xpNeeded} XP</span>
            </div>
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress-fill" id="xpProgressFill" style="width: ${xpProgress}%"></div>
              </div>
              <div style="text-align: center; margin-top: 8px; color: var(--text-secondary);">
                ${Math.floor((xpNeeded - stats.xp) / 10)} more lines to level ${stats.level + 1}
              </div>
            </div>
          </div>

          <!-- Pomodoro Section -->
          <div class="card" id="pomodoroCard">
            <div class="card-header">
              <div class="card-title">🍅 Pomodoro Focus</div>
              <span>${stats.pomodoroStats?.todaySessions || 0} today</span>
            </div>
            <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 16px;">
              <div class="stat-card">
                <span class="stat-value">${stats.pomodoroStats?.currentStreak || 0}</span>
                <div class="stat-label">Current Streak</div>
              </div>
              <div class="stat-card">
                <span class="stat-value">${stats.pomodoroStats?.longestStreak || 0}</span>
                <div class="stat-label">Best Streak</div>
              </div>
              <div class="stat-card">
                <span class="stat-value">${Math.floor((stats.pomodoroStats?.totalWorkTime || 0) / 60)}</span>
                <div class="stat-label">Hours Focused</div>
              </div>
              <div class="stat-card">
                <span class="stat-value">${Math.floor((stats.pomodoroStats?.totalBreakTime || 0) / 60)}</span>
                <div class="stat-label">Break Time</div>
              </div>
            </div>
            <div class="actions" style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button onclick="vscode.postMessage({command: 'startPomodoro'})" class="btn btn-primary">🍅 Start Work (25m)</button>
              <button onclick="vscode.postMessage({command: 'startShortBreak'})" class="btn btn-secondary">☕ Short Break (5m)</button>
              <button onclick="vscode.postMessage({command: 'startLongBreak'})" class="btn btn-secondary">🧘 Long Break (15m)</button>
          ${stats.currentPomodoro ? `
                ${stats.currentPomodoro.state === 'paused' ? '<button onclick="vscode.postMessage({command: \'resumePomodoro\'})" class="btn btn-primary">▶️ Resume</button>' : '<button onclick="vscode.postMessage({command: \'pausePomodoro\'})" class="btn btn-secondary">⏸️ Pause</button>'}
                <button onclick="vscode.postMessage({command: 'stopPomodoro'})" class="btn btn-danger">⏹️ Stop Current</button>` : ''}
            </div>
          </div>

          <!-- Activity Heatmap -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">📈 Coding Activity</div>
              <span>${stats.codingDays} active days</span>
            </div>
            <div class="heatmap-container">
              <div style="color: var(--text-secondary); font-size: 14px; margin-bottom: 8px;">
                Last 3 months • ${stats.averageXpPerDay.toFixed(0)} XP/day average
              </div>
              <div class="heatmap">${heatmapHTML}</div>
            </div>
          </div>

          <!-- Improvement Insights -->
          <div class="card" id="improvementCard">
            <div class="card-header">
              <div class="card-title">Improvement Insights</div>
              <span id="improvementHeadline" class="trend-neutral">Tracking...</span>
            </div>
            <div class="improvement-body">
              <div class="improvement-chart">
                <div class="improvement-chart-grid"></div>
                <svg id="improvementSparkline" viewBox="0 0 300 120" preserveAspectRatio="none"></svg>
                <div class="improvement-tooltip" id="improvementTooltip" style="display: none;"></div>
                <div class="improvement-chart-label" id="improvementChartLabel"></div>
              </div>

              <div class="best-day-chip" id="bestDayChip" style="display: none;"></div>
              <div class="improvement-metrics">
                <div class="improvement-metric">
                  <div class="metric-title">Lines Week / Week</div>
                  <div class="metric-value" id="linesMetricValue">0</div>
                  <div class="metric-delta trend-neutral" id="linesMetricDelta">0%</div>
                </div>
                <div class="improvement-metric">
                  <div class="metric-title">Focus Minutes</div>
                  <div class="metric-value" id="timeMetricValue">0m</div>
                  <div class="metric-delta trend-neutral" id="timeMetricDelta">0%</div>
                </div>
                <div class="improvement-metric">
                  <div class="metric-title">Sessions</div>
                  <div class="metric-value" id="sessionMetricValue">0</div>
                  <div class="metric-delta trend-neutral" id="sessionMetricDelta">0%</div>
                </div>
                <div class="improvement-metric">
                  <div class="metric-title">Pomodoros</div>
                  <div class="metric-value" id="pomodoroMetricValue">0</div>
                  <div class="metric-delta trend-neutral" id="pomodoroMetricDelta">0%</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Achievements -->
          
          <div class="card">
            <div class="card-header">

              <div class="card-title">Recent Achievements</div>
              <span>${stats.newAchievements?.filter(a => a.unlockedAt).length || 0}/${stats.newAchievements?.length || 0}</span>
            </div>
            <div class="achievements-grid">
              ${(achievementsForWeb || []).slice(0, 6).map(achievement => `
                <div class="achievement rarity-${achievement.rarity} ${achievement.unlockedAt ? 'unlocked' : ''}" 
                     onclick="showAchievementDetails('${achievement.id}')">
                  <div class="achievement-icon">
                    <img src="${(imgs.achievementIcons[achievement.iconFile] || imgs.imgStar)}" alt="${achievement.title}" class="achievement-icon-img" onerror="this.onerror=null;this.src='${imgs.imgStar}'" />
                  </div>
                  <div class="achievement-content">
                    <div class="achievement-title">${achievement.title}</div>
                    <div class="achievement-desc">${achievement.description}</div>
                    <div class="achievement-progress">
                      <div class="achievement-progress-fill" style="width: ${achievement.progress}%"></div>
                    </div>
                  </div>
                  ${achievement.unlockedAt ? '<div style="color: var(--success);"><img src="' + imgs.imgCheck + '" alt="Completed" class="status-icon" /></div>' : ''}
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div>
          <!-- Weekly Challenge -->
          ${stats.weeklyChallenge ? `
          <div class="card challenge-card">
            <div class="challenge-title">${stats.weeklyChallenge.title}</div>
            <div class="challenge-desc">${stats.weeklyChallenge.description}</div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${challengeProgress}%"></div>
            </div>
            <div style="text-align: center; margin-top: 8px;">
              ${stats.weeklyChallenge.progress}/${stats.weeklyChallenge.target} • ${challengeProgress.toFixed(0)}% complete
            </div>
            ${stats.weeklyChallenge.completed ? '<div style="text-align: center; margin-top: 8px; color: #3fb950;">Challenge Complete! +' + stats.weeklyChallenge.reward + ' XP</div>' : ''}
          </div>
          ` : ''}

          <!-- Current Project -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">📁 Current Project</div>
              <span style="color: var(--accent);">${stats.currentProject || 'No project detected'}</span>
            </div>
            ${stats.currentProject ? `
            <div style="margin-top: 12px;">
              <div class="language-item">
                <div class="language-name">Lines Coded</div>
                <div class="language-lines">${stats.projectStats[stats.currentProject]?.lines || 0}</div>
              </div>
              <div class="language-item">
                <div class="language-name">Sessions</div>
                <div class="language-lines">${stats.projectStats[stats.currentProject]?.sessions || 0}</div>
              </div>
              <div class="language-item">
                <div class="language-name">Time Spent</div>
                <div class="language-lines">${Math.floor((stats.projectStats[stats.currentProject]?.timeSpent || 0) / 60)}h ${Math.floor((stats.projectStats[stats.currentProject]?.timeSpent || 0) % 60)}m</div>
              </div>
              <div class="language-item">
                <div class="language-name">Languages</div>
                <div class="language-lines">${stats.projectStats[stats.currentProject]?.languages?.length || 0}</div>
              </div>
              <div class="language-item">
                <div class="language-name">Files</div>
                <div class="language-lines">${stats.projectStats[stats.currentProject]?.files?.size || 0}</div>
              </div>
              ${stats.projectStats[stats.currentProject]?.languages?.length > 0 ? `
              <div style="margin-top: 8px; font-size: 12px; color: var(--text-secondary);">
                Languages: ${stats.projectStats[stats.currentProject].languages.join(', ')}
              </div>
              ` : ''}
            </div>
            ` : `
            <div style="margin-top: 12px; text-align: center; color: var(--text-secondary); font-style: italic;">
              Start coding in a project to see statistics here
            </div>
            `}
          </div>

          <!-- Top Projects -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">🏆 Top Projects</div>
            </div>
            ${topProjects.map((project, i) => `
              <div class="project-item" onclick="toggleProjectDetails('${project.name.replace(/'/g, "\\'")}')">
                <div class="project-header">
                  <div class="project-info">
                    <div class="project-name">#${i + 1} ${project.name}</div>
                    <div class="project-stats">${Math.floor(project.timeSpent / 60)}h ${Math.floor(project.timeSpent % 60)}m • ${project.lines} lines</div>
                  </div>
                  <div class="project-chevron">▼</div>
                </div>
                <div class="project-details" id="project-${project.name.replace(/[^a-zA-Z0-9]/g, '_')}" style="display: none;">
                  <div class="project-detail-item">
                    <span class="detail-label">Most Used Language:</span>
                    <span class="detail-value">${project.topLanguage}</span>
                  </div>
                  <div class="project-detail-item">
                    <span class="detail-label">Sessions:</span>
                    <span class="detail-value">${project.sessions}</span>
                  </div>
                  <div class="project-detail-item">
                    <span class="detail-label">Languages:</span>
                    <span class="detail-value">${project.languages.join(', ') || 'None'}</span>
                  </div>
                  <div class="project-detail-item">
                    <span class="detail-label">Files:</span>
                    <span class="detail-value">${project.files.length}</span>
                  </div>
                  <button class="open-project-btn" onclick="openProject('${project.name.replace(/'/g, "\\'")}', '${project.files[0]?.replace(/'/g, "\\'") || ''}')">
                    📂 Open in VS Code
                  </button>
                </div>
              </div>
            `).join('')}
            ${topProjects.length === 0 ? '<div style="color: var(--text-secondary); text-align: center; padding: 20px;">Start coding in projects to see your top projects!</div>' : ''}
          </div>

          <!-- Top Languages -->
          <div class="card" id="topLanguagesCard">
            <div class="card-header">
              <div class="card-title">Top Languages</div>
            </div>
            ${topLanguages.map(([lang, data], i) => `
              <div class="language-item">
                <div class="language-name">#${i + 1} ${lang}</div>
                <div class="language-lines">${data.lines} lines</div>
              </div>
            `).join('')}
            ${topLanguages.length === 0 ? '<div style="color: var(--text-secondary); text-align: center; padding: 20px;">Start coding to see your language stats!</div>' : ''}
          </div>

          <!-- Flow Analysis -->
          <div class="card" id="flowAnalysisCard">
            <div class="card-header">
              <div class="card-title">🌊 Flow Analysis</div>
              <span class="flow-score ${stats.currentSession?.flowMetrics ? (stats.currentSession.flowMetrics.flowScore >= 80 ? 'flow-excellent' : stats.currentSession.flowMetrics.flowScore >= 60 ? 'flow-good' : 'flow-improving') : 'flow-no-data'}">${stats.currentSession?.flowMetrics?.flowScore || '--'}</span>
            </div>
            ${stats.currentSession?.flowMetrics ? `
            <div class="flow-metrics">
              <div class="language-item">
                <div class="language-name">⚡ Flow Score</div>
                <div class="language-lines">${stats.currentSession.flowMetrics.flowScore}/100</div>
              </div>
              <div class="language-item">
                <div class="language-name">🔥 Longest Burst</div>
                <div class="language-lines">${stats.currentSession.flowMetrics.longestBurst}m</div>
              </div>
              <div class="language-item">
                <div class="language-name">⏸️ Interruptions</div>
                <div class="language-lines">${stats.currentSession.flowMetrics.interruptions}</div>
              </div>
              <div class="language-item">
                <div class="language-name">📂 File Switches</div>
                <div class="language-lines">${stats.currentSession.flowMetrics.fileSwitches}</div>
              </div>
              <div class="language-item">
                <div class="language-name">⌨️ Typing Bursts</div>
                <div class="language-lines">${stats.currentSession.flowMetrics.typingBursts}</div>
              </div>
              <div class="language-item">
                <div class="language-name">⏱️ Avg Gap Time</div>
                <div class="language-lines">${stats.currentSession.flowMetrics.averageGapTime}s</div>
              </div>
            </div>
            <div class="flow-tips">
              ${getFlowTips(stats.currentSession.flowMetrics)}
            </div>
            ` : `
            <div style="color: var(--text-secondary); text-align: center; padding: 20px;">
              Start a coding session to see your flow analysis!
            </div>
            `}
          </div>

          <!-- Quick Stats -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Quick Stats</div>
            </div>
            <div class="language-item">
              <div class="language-name">Favorite Language</div>
              <div class="language-lines">${stats.favoriteLanguage}</div>
            </div>
            <div class="language-item">
              <div class="language-name">Most Productive Hour</div>
              <div class="language-lines">${stats.mostProductiveHour}:00</div>
            </div>
            <div class="language-item">
              <div class="language-name">Total Sessions</div>
              <div class="language-lines">${stats.totalSessions}</div>
            </div>
            <div class="language-item">
              <div class="language-name">Avg Session</div>
              <div class="language-lines">${stats.averageSessionLength.toFixed(0)}m</div>
            </div>
          </div>

          <!-- Actions -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">⚡ Actions</div>
            </div>
            <div class="actions">
              <button id="changeName" class="btn btn-primary">✏️ Change Name</button>
              <button id="reset" class="btn btn-secondary">🔄 Reset Stats</button>
              <button id="export" class="btn btn-primary">Export Data</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Achievement Details Modal -->
    <div id="achievementModal" class="modal">
      <div class="modal-content">
        <span class="modal-close" onclick="closeAchievementModal()">&times;</span>
        <div class="modal-achievement">
          <div class="modal-achievement-icon">
            <img id="modalAchievementIcon" src="" alt="Achievement" />
          </div>
          <div class="modal-achievement-title" id="modalAchievementTitle"></div>
          <div class="modal-achievement-desc" id="modalAchievementDesc"></div>
          
          <div class="modal-progress-section">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Progress</span>
              <span id="modalProgressText">0%</span>
            </div>
            <div class="modal-progress-bar">
              <div class="modal-progress-fill" id="modalProgressFill" style="width: 0%"></div>
            </div>
          </div>
          
          <div class="modal-tips">
            <h4>How to achieve this:</h4>
            <p id="modalTips"></p>
          </div>
        </div>
      </div>
    </div>

    <script>
      const vscode = acquireVsCodeApi();
      const achievements = ${JSON.stringify(achievementsForWeb)};
      const achievementIcons = ${JSON.stringify(imgs.achievementIcons)};
  const improvementData = ${JSON.stringify(improvementSnapshot)};
    const improvementTooltip = document.getElementById('improvementTooltip');
      
      function resolveIcon(ach){
        // The extension already resolved iconFile. We'll rebuild predictable name guesses too.
        const candidates = [ach.iconFile, ach.icon, ach.icon?.replace('first-steps','first-step')];
        for (const c of candidates) {
          if (c && achievementIcons[c]) return achievementIcons[c];
        }
        return '${imgs.imgStar}';
      }
      
      function showAchievementDetails(achievementId) {
        const achievement = achievements.find(a => a.id === achievementId);
        if (!achievement) return;
        const iconSrc = resolveIcon(achievement);
        const iconEl = document.getElementById('modalAchievementIcon');
        iconEl.src = iconSrc;
        iconEl.onerror = () => { iconEl.onerror = null; iconEl.src = '${imgs.imgStar}'; };
        document.getElementById('modalAchievementTitle').textContent = achievement.title;
        document.getElementById('modalAchievementDesc').textContent = achievement.description;
  document.getElementById('modalProgressText').textContent = (Math.round(achievement.progress)) + '%';
  document.getElementById('modalProgressFill').style.width = achievement.progress + '%';
        document.getElementById('modalTips').textContent = getAchievementTips(achievement);
        document.getElementById('achievementModal').style.display = 'block';
      }
      
      function closeAchievementModal() {
        document.getElementById('achievementModal').style.display = 'none';
      }
      
      function getAchievementTips(achievement) {
        const tips = {
          'first-steps': 'Simply start coding! Write any line of code to unlock this.',
          'streak-warrior': 'Code at least one line every day for 7 consecutive days.',
          'streak-legend': 'Maintain your daily coding habit for 30 days straight.',
          'century-streak': 'Keep coding daily for 100 days - the ultimate dedication!',
          'speed-demon': 'Write 100 lines of code in a single coding session without breaks.',
          'marathon-coder': 'Code continuously for 4 hours. Take short breaks but keep VS Code active.',
          'early-bird': 'Start coding before 6:00 AM to unlock this achievement.',
          'weekend-warrior': 'Code on both Saturday and Sunday to earn this badge.',
          'polyglot': 'Write code in 5 different programming languages (JavaScript, Python, etc.).',
          'master-builder': 'Write a total of 10,000 lines of code across all your projects.',
          'perfectionist': 'Delete more lines than you write in a single day (refactoring counts!).',
          'team-player': 'Work on 3 different files in a single coding session.',
          'consistent-contributor': 'Code every single day for 7 consecutive days.',
          'midnight-hacker': 'Code at exactly midnight (00:00) to unlock this rare achievement.',
          'bug-hunter': 'Delete a total of 1,000 lines of code (fixing bugs and refactoring).',
          'weekend-grinder': 'Code for 8 hours on a weekend day (Saturday or Sunday).'
        };
        return tips[achievement.id] || 'Keep coding to unlock this achievement!';
      }
      
      function toggleProjectDetails(projectName) {
        const elementId = 'project-' + projectName.replace(/[^a-zA-Z0-9]/g, '_');
        const detailsEl = document.getElementById(elementId);
        const projectItem = detailsEl?.parentElement;
        const chevron = projectItem?.querySelector('.project-chevron');
        
        if (detailsEl && projectItem && chevron) {
          if (detailsEl.style.display === 'none') {
            detailsEl.style.display = 'block';
            projectItem.classList.add('expanded');
            chevron.textContent = '▲';
          } else {
            detailsEl.style.display = 'none';
            projectItem.classList.remove('expanded');
            chevron.textContent = '▼';
          }
        }
      }
      
      function openProject(projectName, filePath) {
        vscode.postMessage({ 
          type: 'openProject', 
          projectName: projectName,
          filePath: filePath
        });
      }

      function formatShortDate(dateStr) {
        if (!dateStr) {
          return '';
        }
        try {
          const date = new Date(dateStr + 'T00:00:00');
          return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        } catch (error) {
          return dateStr;
        }
      }

      function formatMinutes(totalMinutes) {
        if (typeof totalMinutes !== 'number' || !isFinite(totalMinutes)) {
          return '0m';
        }
        const minutes = Math.abs(Math.round(totalMinutes));
        if (minutes === 0) {
          return '0m';
        }
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours === 0) {
          return mins + 'm';
        }
        return mins === 0 ? hours + 'h' : hours + 'h ' + mins + 'm';
      }

      function trendPrefix(value) {
        if (value > 0) {
          return '+';
        }
        if (value < 0) {
          return '-';
        }
        return '';
      }

      function setTrendClass(element, value) {
        if (!element) {
          return;
        }
        element.classList.remove('trend-positive', 'trend-negative', 'trend-neutral');
        if (value > 0) {
          element.classList.add('trend-positive');
        } else if (value < 0) {
          element.classList.add('trend-negative');
        } else {
          element.classList.add('trend-neutral');
        }
      }

      function renderSparkline(svg, dailyData) {
        if (!svg) {
          return;
        }
        const values = (dailyData || []).map(function(day) { return Math.max(0, day.lines || 0); });
        const totalPoints = values.length;
        const width = 300;
        const height = 120;
        const padding = 8;

        if (totalPoints === 0) {
          svg.innerHTML = '';
          if (improvementTooltip) {
            improvementTooltip.style.display = 'none';
          }
          return;
        }

        const max = Math.max.apply(null, values.concat(1));
        const min = Math.min.apply(null, values.concat(0));
        const range = Math.max(max - min, 1);
        const step = totalPoints > 1 ? width / (totalPoints - 1) : width;

        const pointData = values.map(function(value, index) {
          const x = index * step;
          const y = height - (((value - min) / range) * (height - padding * 2) + padding);
          const day = (dailyData && dailyData[index]) ? dailyData[index] : { date: '', lines: 0, timeSpent: 0, sessions: 0 };
          return { x: x, y: y, day: day, index: index };
        });

        const linePoints = pointData
          .map(function(pt) {
            return pt.x.toFixed(2) + ',' + pt.y.toFixed(2);
          })
          .join(' ');

        const areaPoints = '0,' + height + ' ' + linePoints + ' ' + width + ',' + height;
        const circlesMarkup = pointData
          .map(function(pt) {
            return '<circle class="spark-point" data-index="' + pt.index + '" cx="' + pt.x.toFixed(2) + '" cy="' + pt.y.toFixed(2) + '" r="3.2"></circle>';
          })
          .join('');

        svg.innerHTML = '<polyline points="' + areaPoints + '" fill="rgba(34, 197, 94, 0.12)" stroke="none"></polyline>' +
          '<polyline points="' + linePoints + '" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>' +
          circlesMarkup;

        const tooltip = improvementTooltip;
        const chartContainer = svg.parentElement;
        if (!tooltip || !chartContainer) {
          return;
        }

        let activeIndex = -1;

        function activatePoint(index, clientX, clientY) {
          const clampedIndex = Math.max(0, Math.min(pointData.length - 1, index));
          if (pointData.length === 0) {
            return;
          }
          if (clampedIndex === activeIndex && tooltip.style.display === 'block') {
            positionTooltip(clientX, clientY);
            return;
          }

          activeIndex = clampedIndex;
          const circles = svg.querySelectorAll('.spark-point');
          circles.forEach(function(circle) {
            circle.classList.remove('spark-point-active');
            circle.setAttribute('r', '3.2');
          });

          const activeCircle = svg.querySelector('circle[data-index="' + clampedIndex + '"]');
          if (activeCircle) {
            activeCircle.classList.add('spark-point-active');
            activeCircle.setAttribute('r', '4.6');
          }

          const day = pointData[clampedIndex].day;
          const focusText = formatMinutes(day.timeSpent || 0);
          tooltip.innerHTML = '<strong>' + formatShortDate(day.date) + '</strong>' +
            (day.lines || 0) + ' lines · ' + focusText + ' focus · ' + (day.sessions || 0) + ' sessions';
          tooltip.style.display = 'block';
          positionTooltip(clientX, clientY);
        }

        function positionTooltip(clientX, clientY) {
          if (!chartContainer) {
            return;
          }
          const chartRect = chartContainer.getBoundingClientRect();
          const offsetX = clientX - chartRect.left;
          const offsetY = clientY - chartRect.top;
          const tooltipRect = tooltip.getBoundingClientRect();
          const tooltipWidth = tooltipRect.width || 0;
          const tooltipHeight = tooltipRect.height || 0;

          const minX = tooltipWidth / 2 + 8;
          const maxX = chartRect.width - tooltipWidth / 2 - 8;
          const minY = tooltipHeight + 18;
          const maxY = chartRect.height - 12;

          const constrainedX = Math.max(minX, Math.min(maxX, offsetX));
          const constrainedY = Math.max(minY, Math.min(maxY, offsetY));

          tooltip.style.left = constrainedX + 'px';
          tooltip.style.top = constrainedY + 'px';
        }

        function handlePointerMove(event) {
          const rect = svg.getBoundingClientRect();
          if (rect.width <= 0) {
            return;
          }
          const relativeX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
          const ratio = totalPoints > 1 ? relativeX / rect.width : 0;
          const index = Math.round(ratio * (pointData.length - 1));
          activatePoint(index, event.clientX, event.clientY);
        }

        svg.onmousemove = handlePointerMove;
        svg.ontouchmove = function(event) {
          if (event.touches && event.touches.length > 0) {
            handlePointerMove(event.touches[0]);
          }
        };

        svg.onmouseleave = function() {
          activeIndex = -1;
          tooltip.style.display = 'none';
          const circles = svg.querySelectorAll('.spark-point');
          circles.forEach(function(circle) {
            circle.classList.remove('spark-point-active');
            circle.setAttribute('r', '3.2');
          });
        };
      }

      function renderImprovementCard(data) {
        if (!data) {
          return;
        }

        if (improvementTooltip) {
          improvementTooltip.style.display = 'none';
        }

        const headline = document.getElementById('improvementHeadline');
        const chartLabel = document.getElementById('improvementChartLabel');
        const bestDayChip = document.getElementById('bestDayChip');

        const linesValue = document.getElementById('linesMetricValue');
        const linesDelta = document.getElementById('linesMetricDelta');
        const timeValue = document.getElementById('timeMetricValue');
        const timeDelta = document.getElementById('timeMetricDelta');
        const sessionValue = document.getElementById('sessionMetricValue');
        const sessionDelta = document.getElementById('sessionMetricDelta');
        const pomodoroValue = document.getElementById('pomodoroMetricValue');
        const pomodoroDelta = document.getElementById('pomodoroMetricDelta');

        const week = data.weekComparison || {};
        const pomos = data.pomodoroComparison || {};
        const linesPercent = week.linesPercent || 0;

        if (headline) {
          if (linesPercent > 0) {
            headline.textContent = '🔥 Up ' + linesPercent + '% vs last week';
          } else if (linesPercent < 0) {
            headline.textContent = 'Heads up: ' + linesPercent + '% vs last week';
          } else {
            headline.textContent = 'Even with last week';
          }
          setTrendClass(headline, linesPercent);
        }

        if (chartLabel && Array.isArray(data.last14Days)) {
          const totalLines = data.last14Days.reduce(function(sum, day) { return sum + (day.lines || 0); }, 0);
          const avgLines = totalLines / Math.max(data.last14Days.length, 1);
          chartLabel.textContent = 'Last 14 days • Avg ' + Math.round(avgLines) + ' lines/day';
        }

        if (bestDayChip && data.bestDay && data.bestDay.lines > 0) {
          bestDayChip.style.display = 'inline-flex';
          bestDayChip.textContent = '🏆 Best day ' + formatShortDate(data.bestDay.date) + ' • ' + data.bestDay.lines + ' lines';
        } else if (bestDayChip) {
          bestDayChip.style.display = 'none';
        }

        if (linesValue) {
          linesValue.textContent = (week.currentLines || 0).toLocaleString();
        }
        if (linesDelta) {
          const deltaLines = week.linesDelta || 0;
          const percentLines = linesPercent || 0;
          if (deltaLines === 0 && percentLines === 0) {
            linesDelta.textContent = '0 lines (0%)';
          } else {
            linesDelta.textContent = trendPrefix(deltaLines) + Math.abs(deltaLines).toLocaleString() + ' lines (' + trendPrefix(percentLines) + Math.abs(percentLines) + '%)';
          }
          setTrendClass(linesDelta, deltaLines);
        }

        if (timeValue) {
          timeValue.textContent = formatMinutes(week.currentTime || 0);
        }
        if (timeDelta) {
          const deltaTime = week.timeDelta || 0;
          const percentTime = week.timePercent || 0;
          if (deltaTime === 0 && percentTime === 0) {
            timeDelta.textContent = '0m (0%)';
          } else {
            timeDelta.textContent = trendPrefix(deltaTime) + formatMinutes(deltaTime) + ' (' + trendPrefix(percentTime) + Math.abs(percentTime) + '%)';
          }
          setTrendClass(timeDelta, deltaTime);
        }

        if (sessionValue) {
          sessionValue.textContent = (week.currentSessions || 0).toLocaleString();
        }
        if (sessionDelta) {
          const deltaSessions = week.sessionDelta || 0;
          const percentSessions = week.sessionPercent || 0;
          if (deltaSessions === 0 && percentSessions === 0) {
            sessionDelta.textContent = '0 (0%)';
          } else {
            sessionDelta.textContent = trendPrefix(deltaSessions) + Math.abs(deltaSessions).toLocaleString() + ' (' + trendPrefix(percentSessions) + Math.abs(percentSessions) + '%)';
          }
          setTrendClass(sessionDelta, deltaSessions);
        }

        if (pomodoroValue) {
          pomodoroValue.textContent = (pomos.currentWork || 0).toLocaleString();
        }
        if (pomodoroDelta) {
          const deltaPomos = pomos.delta || 0;
          const percentPomos = pomos.percent || 0;
          if (deltaPomos === 0 && percentPomos === 0) {
            pomodoroDelta.textContent = '0 (0%)';
          } else {
            pomodoroDelta.textContent = trendPrefix(deltaPomos) + Math.abs(deltaPomos).toLocaleString() + ' (' + trendPrefix(percentPomos) + Math.abs(percentPomos) + '%)';
          }
          setTrendClass(pomodoroDelta, deltaPomos);
        }

        renderSparkline(document.getElementById('improvementSparkline'), data.last14Days);
      }

      renderImprovementCard(improvementData);

      const celebrationContainer = document.getElementById('celebration-container');
      const confettiLayer = document.getElementById('confetti-layer');
      const celebrationColors = [
        'var(--accent)',
        'var(--accent-secondary)',
        'var(--success)',
        'var(--warning)',
        '#FF8A80',
        '#8C9EFF'
      ];

      function updateAccentRgb() {
        const accentValue = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        if (!accentValue) {
          return;
        }
        const tmp = document.createElement('span');
        tmp.style.color = accentValue;
        tmp.style.display = 'none';
        document.body.appendChild(tmp);
        const computed = getComputedStyle(tmp).color;
        document.body.removeChild(tmp);
        const match = computed.match(/rgba?\(([^)]+)\)/);
        if (match && match[1]) {
          document.documentElement.style.setProperty('--accent-rgb', match[1]);
        }
      }

      function showCelebrationToast(message) {
        if (!celebrationContainer) {
          return;
        }
        const toast = document.createElement('div');
        toast.className = 'celebration-toast';
        toast.textContent = message;
        celebrationContainer.appendChild(toast);
        requestAnimationFrame(() => {
          toast.classList.add('visible');
        });
        setTimeout(() => {
          toast.classList.remove('visible');
          setTimeout(() => toast.remove(), 300);
        }, 4200);
        while (celebrationContainer.children.length > 3) {
          celebrationContainer.firstElementChild.remove();
        }
      }

      function highlightElement(selector, effect) {
        if (!selector) {
          return;
        }
        const element = document.querySelector(selector);
        if (!element) {
          return;
        }
        element.classList.add('celebration-highlight');
        if (effect === 'pulse') {
          element.classList.add('celebration-scale');
        }
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        setTimeout(() => {
          element.classList.remove('celebration-highlight');
          element.classList.remove('celebration-scale');
        }, 1400);
      }

      function launchConfetti() {
        if (!confettiLayer) {
          return;
        }
        for (let i = 0; i < 26; i++) {
          const piece = document.createElement('div');
          piece.className = 'confetti-piece';
          piece.style.left = Math.random() * 100 + '%';
          piece.style.setProperty('--drift', (Math.random() * 260 - 130).toFixed(0));
          piece.style.animationDelay = (Math.random() * 0.2) + 's';
          piece.style.background = celebrationColors[i % celebrationColors.length];
          confettiLayer.appendChild(piece);
          setTimeout(() => piece.remove(), 1600);
        }
      }

      function handleCelebrationEvent(event) {
        if (!event) {
          return;
        }
        if (event.message) {
          showCelebrationToast(event.message);
        }
        if (event.effect === 'confetti') {
          launchConfetti();
        }
        if (event.highlightSelector) {
          highlightElement(event.highlightSelector, event.effect);
        }
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message) {
          return;
        }
        if (message.type === 'celebrations' && Array.isArray(message.events)) {
          message.events.forEach(handleCelebrationEvent);
        } else if (message.type === 'themeChanged') {
          updateAccentRgb();
        }
      });

      setTimeout(() => {
        updateAccentRgb();
        vscode.postMessage({ type: 'ready' });
      }, 0);

      
      window.onclick = function(event) {
        const modal = document.getElementById('achievementModal');
        if (event.target === modal) {
          closeAchievementModal();
        }
      }
      
      document.getElementById('changeName')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'changeName' });
      });
      
      document.getElementById('reset')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset all your progress?')) {
          vscode.postMessage({ type: 'reset' });
        }
      });
      
      document.getElementById('export')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'export' });
      });


    </script>
    
    <!-- Additional Sections: Achievement Gallery & Icon Legend -->
    <div class="container">
      <div style="display:grid; gap:24px; grid-template-columns: 2fr 1fr; margin-top:32px;">
        <!-- Achievement Gallery (ensures every asset is displayed) -->
        <div class="card">

          <div class="card-header">
            <div class="card-title">Achievement Gallery - Earn Your Stars! ⭐</div>
            <span style="color: var(--text-secondary); font-size:12px;">Each achievement unlocked = +1 Star (unique icons when available)</span>
          </div>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap:16px;">
            ${['first-step','streak-warrior','streak-legend','weekend-warrior','early-bird','midnight-hacker','bug-hunter','polyglot','master-builder','perfectionist']
              .map(file => {
                const src = imgs.achievementIcons[file] || imgs.imgStar; // Use specific icon if available, star as fallback
                // Find matching achievement object (by mapped iconFile OR id heuristic)
                const logical = (stats.newAchievements || []).find(a => a.icon === file || a.icon === file.replace('first-step','first-steps'));
                const click = logical ? `onclick=\"showAchievementDetails('${logical.id}')\"` : '';
                const isClickable = logical ? 'clickable' : '';
                const isUnlocked = logical?.unlockedAt ? 'unlocked' : '';
                const isStarIcon = !imgs.achievementIcons[file]; // Check if using star fallback
                return `
                  <div ${click} class="gallery-item ${isClickable} ${isUnlocked}" style="cursor:${logical ? 'pointer':'default'};text-align:center; background: var(--bg-secondary); padding:12px; border-radius:8px; position: relative;">
                    <img src="${src}" alt="${file}" style="width:32px;height:32px;object-fit:contain;margin-bottom:6px; ${!logical?.unlockedAt ? 'filter: grayscale(100%) opacity(0.5);' : (isStarIcon ? 'filter: drop-shadow(0 0 4px rgba(255, 215, 0, 0.8));' : '')}" />
                    <div style="font-size:11px; color: var(--text-secondary); word-break: break-word;">${logical?.title || file}</div>
                    ${logical?.unlockedAt ? '<div style="position:absolute;top:4px;right:4px; color:#ffd700; font-size:14px;">⭐</div>' : ''}
                    ${logical && !logical.unlockedAt ? '<div style="position:absolute;top:4px;right:4px; background:var(--accent); color:white; font-size:10px; padding:2px 4px; border-radius:4px;">' + Math.round(logical.progress) + '%</div>' : ''}
                  </div>`;
              }).join('')}
          </div>
        </div>

        <!-- Icon Legend -->
        <div class="card">
          <div class="card-header"><div class="card-title">Icon Legend</div></div>
          <div style="display:flex; flex-direction:column; gap:12px;">
            <div style="display:flex; align-items:center; gap:12px;">
              <img src="${imgs.imgLevelUp}" style="width:32px;height:32px;" alt="Level" />
              <div>
                <div style="font-weight:600;">Level Up Icon</div>
                <div style="font-size:12px; color: var(--text-secondary);">Represents your profile avatar in the dashboard.</div>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
              <img src="${imgs.imgFlame}" style="width:32px;height:32px;" alt="Streak" />
              <div>
                <div style="font-weight:600;">Flame Icon</div>
                <div style="font-size:12px; color: var(--text-secondary);">Shows your active day streak.</div>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
              <img src="${imgs.imgStar}" style="width:32px;height:32px;" alt="Star" />
              <div>
                <div style="font-weight:600;">Star System</div>
                <div style="font-size:12px; color: var(--text-secondary);">Earn stars by unlocking achievements. More stars = better coder!</div>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
              <img src="${imgs.imgMedal}" style="width:32px;height:32px;" alt="Medal" />
              <div>
                <div style="font-weight:600;">Medal Icon</div>
                <div style="font-size:12px; color: var(--text-secondary);">Represents leaderboard or recognition areas.</div>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
              <img src="${imgs.imgCheck}" style="width:32px;height:32px;" alt="Completed" />
              <div>

                <div style="font-weight:600;">Checkmark Icon</div>
                <div style="font-size:12px; color: var(--text-secondary);">Indicates a completed achievement.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Achievement Details Modal -->
    <div id="achievementModal" style="display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5);">
      <div style="background-color: var(--card); margin: 15% auto; padding: 20px; border: 1px solid var(--border); border-radius: 12px; width: 400px; max-width: 80%;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h3 style="margin: 0; color: var(--text);">Achievement Details</h3>
          <span onclick="closeAchievementModal()" style="cursor: pointer; font-size: 24px; color: var(--text-secondary);">&times;</span>
        </div>
        
        <div style="text-align: center; margin-bottom: 16px;">
          <img id="modalAchievementIcon" src="" alt="Achievement Icon" style="width: 60px; height: 60px; object-fit: contain; border-radius: 50%; border: 3px solid var(--accent); background: var(--bg-secondary); padding: 8px;" />
        </div>
        
        <div style="text-align: center; margin-bottom: 16px;">
          <h4 id="modalAchievementTitle" style="margin: 8px 0; color: var(--text);"></h4>
          <p id="modalAchievementDesc" style="margin: 8px 0; color: var(--text-secondary); font-size: 14px;"></p>
        </div>
        
        <div style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="color: var(--text-secondary); font-size: 12px;">Progress</span>
            <span id="modalProgressText" style="color: var(--text); font-size: 12px; font-weight: 600;"></span>
          </div>
          <div style="width: 100%; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden;">
            <div id="modalProgressFill" style="height: 100%; background: var(--accent); transition: width 0.3s ease; width: 0%;"></div>
          </div>
        </div>
        
        <div style="background: var(--bg-secondary); padding: 12px; border-radius: 8px; border: 1px solid var(--border);">
          <h5 style="margin: 0 0 8px 0; color: var(--text); font-size: 14px;">💡 How to unlock:</h5>
          <p id="modalTips" style="margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.4;"></p>
        </div>
      </div>
    </div>
  </body>
  </html>`;
}


function getUserId(context: vscode.ExtensionContext): string {
  let id = context.globalState.get<string>('codiva.userId');
  if (!id) {
    const mid = vscode.env.machineId || Math.random().toString(36).slice(2);
    id = `codiva-${mid}`;
    context.globalState.update('codiva.userId', id);
  }
  return id;
}

// Snapshot of key stats for export or sharing
function buildSnapshot(context: vscode.ExtensionContext, stats: CodivaStats) {
  const userId = getUserId(context);
  const todayKey = toDateKey(new Date());
  const today = stats.history[todayKey];
  const topLang = Object.entries(stats.languageStats || {})
    .sort(([, a], [, b]) => b.lines - a.lines)[0]?.[0] || stats.favoriteLanguage || 'unknown';
  return {
    userId,
    name: stats.userName || 'Developer',
    streak: stats.streak || 0,
    maxStreak: stats.maxStreak || stats.streak || 0,
    todayLines: today?.added || 0,
    totalLines: stats.manualLines || 0,
    totalXp: stats.totalXp || 0,
    level: stats.level || 1,
    favoriteLanguage: topLang,
    mostProductiveHour: stats.mostProductiveHour || 0,
    codingDays: stats.codingDays || 0,
    lastCoded: stats.lastCoded ? stats.lastCoded.toISOString() : null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    version: '0.1.0'
  };
}






function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Extract project name from file path
function extractProjectName(filePath: string): string {
  if (!filePath) return 'Unknown';
  
  // Remove file extension and get the path parts
  const pathParts = filePath.replace(/\\/g, '/').split('/');
  
  // Start from the file's directory and work backwards
  for (let i = pathParts.length - 2; i >= 0; i--) {
    const currentDir = pathParts[i];
    
    // Skip common non-project directories
    if (['src', 'lib', 'components', 'pages', 'utils', 'helpers', 'services', 'models', 'views', 'controllers'].includes(currentDir.toLowerCase())) {
      continue;
    }
    
    // This could be the project name
    if (currentDir && currentDir !== '.' && currentDir !== '..' && !currentDir.startsWith('.')) {
      return currentDir;
    }
  }
  
  // Fallback: use the parent directory of the file
  return pathParts.length > 1 ? pathParts[pathParts.length - 2] || 'Unknown' : 'Unknown';
}

function computeConsecutiveStreak(history: Record<string, DayRecord> = {}): number {
  const todayKey = toDateKey(new Date());
  const isActive = (k: string) => {
    const r = history[k];
    return !!r && (((r.added ?? 0) > 0) || ((r.removed ?? 0) > 0) || r.touched === true);
  };
  if (!isActive(todayKey)) return 0;

  let streak = 0;
  let d = new Date();
  while (true) {
    const k = toDateKey(d);
    if (!isActive(k)) break;
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function isValidCodeChange(change: string, fileName: string, stats: CodivaStats): boolean {
  const now = Date.now();
  
  if (!change || change.trim().length === 0) return false;
  
  // Minimum meaningful content length (at least 3 characters of non-whitespace)
  const meaningfulContent = change.replace(/\s/g, '');
  if (meaningfulContent.length < 3) return false;
  
  // Check for repetitive spam patterns
  if (/^(.)\1{10,}/.test(change)) return false; // Same character repeated 10+ times
  if (/^(..)\1{5,}/.test(change)) return false; // Same 2 characters repeated 5+ times
  
  // Rate limiting: max 30 changes per minute
  const oneMinuteAgo = now - 60 * 1000;
  const recentValidChanges = stats.recentChanges.filter(c => c.timestamp > oneMinuteAgo);
  if (recentValidChanges.length >= 30) return false;
  
  // Check for rapid identical content (spam detection)
  const identicalRecent = stats.recentChanges
    .filter(c => c.timestamp > now - 5000) // Last 5 seconds
    .filter(c => c.content === change);
  if (identicalRecent.length >= 3) return false; // Same content 3+ times in 5 seconds
  
  // Language-specific validation
  const language = fileName.split('.').pop()?.toLowerCase() || 'unknown';
  if (!isValidForLanguage(change, language)) return false;
  
  return true;
}

function isValidForLanguage(content: string, extension: string): boolean {
  // Remove pure whitespace-only content
  if (/^\s*$/.test(content)) return false;
  
  // Language-specific patterns
  switch (extension) {
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
      // Require some meaningful JS/TS content
      return /[a-zA-Z_$][a-zA-Z0-9_$]*|[{}();,.]|\S{3,}/.test(content);
    
    case 'py':
      // Python patterns for identifiers and keywords
      return /[a-zA-Z_][a-zA-Z0-9_]*|[(){}[\]:,.]|\S{3,}/.test(content);
    
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
      // C-style languages
      return /[a-zA-Z_][a-zA-Z0-9_]*|[{}();,.]|\S{3,}/.test(content);
    
    case 'html':
    case 'xml':
      // Markup languages in tags or meaningful text
      return /<[^>]+>|\S{3,}/.test(content);
    
    case 'css':
    case 'scss':
    case 'sass':
      // CSS patterns
      return /[a-zA-Z-]+\s*:|[{}();,.]|\S{3,}/.test(content);
    
    default:
      // Generic validation: require at least 3 meaningful characters
      return /\S{3,}/.test(content);
  }
}

function updateRecentChanges(stats: CodivaStats, content: string, fileName: string) {
  const now = Date.now();
  
  // Add new change
  stats.recentChanges.push({
    timestamp: now,
    content: content.substring(0, 100), // Store first 100 chars
    file: fileName
  });
  
  // Keep only last 10 changes and clean old ones
  stats.recentChanges = stats.recentChanges
    .filter(c => c.timestamp > now - 5 * 60 * 1000) // Keep last 5 minutes
    .slice(-10); // Keep last 10 changes in the array
}

// User onboarding
async function handleFirstTimeUser(context: vscode.ExtensionContext, stats: CodivaStats): Promise<void> {
  if (!stats.isFirstTime || stats.userName) return;
  
  const userName = await vscode.window.showInputBox({
    prompt: 'Welcome to Codiva! What should we call you?',
    placeHolder: 'Enter your name (e.g., Alex, Sarah, Dev Ninja...)',
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Please enter a name';
      }
      if (value.trim().length > 50) {
        return 'Name is too long (max 50 characters)';
      }
      if (!/^[a-zA-Z0-9\s\-_]+$/.test(value.trim())) {
        return 'Name can only contain letters, numbers, spaces, hyphens, and underscores';
      }
      return null;
    }
  });
  
  if (userName && userName.trim()) {
    stats.userName = userName.trim();
    stats.isFirstTime = false;
    
    // Show welcome message
    const result = await vscode.window.showInformationMessage(
      `Welcome to your coding journey, ${stats.userName}! Start coding to earn XP, unlock achievements, and track your progress.`,
      'View Dashboard', 'Got it!'
    );
    
    if (result === 'View Dashboard') {
      vscode.commands.executeCommand('codiva.showDashboard');
    }
    
    // Save the updated stats
    saveStats(context, stats);
  } else {
    // User cancelled, set a default name but mark as first time
    stats.userName = 'Developer';
    stats.isFirstTime = false;
    saveStats(context, stats);
  }
}

// Smart Notifications
function checkDailyGoal(stats: CodivaStats) {
  const today = toDateKey(new Date());
  const todayRecord = stats.history[today];
  const todayLines = todayRecord ? todayRecord.added : 0;
  
  // Check if daily goal is reached for the first time today
  if (todayLines >= stats.dailyGoal && !stats.history[today]?.touched) {
    vscode.window.showInformationMessage(
      `Daily goal reached! ${todayLines}/${stats.dailyGoal} lines completed. Keep it up!`,
      'View Dashboard'
    ).then(selection => {
      if (selection) {
        vscode.commands.executeCommand('codiva.showDashboard');
      }
    });
    if (stats.history[today]) stats.history[today].touched = true;
  }
}

function checkStreakReminders(stats: CodivaStats, now: Date) {
  const hour = now.getHours();
  const today = toDateKey(now);
  const todayRecord = stats.history[today];
  
  // Evening reminder if no coding today (only show between 6-9 PM)
  if (hour >= 18 && hour <= 21 && (!todayRecord || todayRecord.added === 0)) {
    // Only remind once per day
    const lastReminder = stats.lastCoded ? toDateKey(stats.lastCoded) : '';
    if (lastReminder !== today) {
      vscode.window.showInformationMessage(
        `Keep your ${stats.streak}-day streak alive! Code a few lines today.`,
        'Open File', 'Later'
      ).then(selection => {
        if (selection === 'Open File') {
          vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
        }
      });
    }
  }
}

// Enhanced Achievement System
function initializeAchievements(): Achievement[] {
  return [
    // Streak category
    { id: 'first-steps', title: 'First Steps', description: 'Code for the first time', icon: 'first-steps', category: 'streak', rarity: 'common', progress: 0, target: 1 },
    { id: 'streak-warrior', title: 'Streak Warrior', description: 'Maintain a 7-day coding streak', icon: 'streak-warrior', category: 'streak', rarity: 'rare', progress: 0, target: 7 },
    { id: 'streak-legend', title: 'Streak Legend', description: 'Maintain a 30-day coding streak', icon: 'streak-legend', category: 'streak', rarity: 'epic', progress: 0, target: 30 },
    { id: 'century-streak', title: 'Century Streak', description: 'Maintain a 100-day coding streak', icon: 'century-streak', category: 'streak', rarity: 'legendary', progress: 0, target: 100 },
    { id: 'yearly-streak', title: 'Yearly Streak', description: 'Maintain a 365-day coding streak', icon: 'century-streak', category: 'streak', rarity: 'legendary', progress: 0, target: 365 },
    
    
    // Productivity category  
    { id: 'speed-demon', title: 'Speed Demon', description: 'Write 100 lines in a single session', icon: 'speed-demon', category: 'productivity', rarity: 'rare', progress: 0, target: 100 },
    { id: 'master-speed-demon', title: 'Master Speed Demon', description: 'Write 1,000 lines in a single session', icon: 'speed-demon', category: 'productivity', rarity: 'epic', progress: 0, target: 1000 },
    { id: 'marathon-coder', title: 'Marathon Coder', description: 'Code for 4 hours straight', icon: 'marathon-coder', category: 'productivity', rarity: 'epic', progress: 0, target: 240 },
    { id: 'early-bird', title: 'Early Bird', description: 'Code before 6 AM', icon: 'early-bird', category: 'productivity', rarity: 'common', progress: 0, target: 1 },
    { id: 'weekend-warrior', title: 'Weekend Warrior', description: 'Code on weekends', icon: 'weekend-warrior', category: 'productivity', rarity: 'common', progress: 0, target: 2 },
    
    // Mastery category
    { id: 'polyglot', title: 'Polyglot', description: 'Code in 5 different languages', icon: 'polyglot', category: 'mastery', rarity: 'epic', progress: 0, target: 5 },
    { id: 'advanced-polyglot', title: 'Advanced Polyglot', description: 'Code in 10 different languages', icon: 'polyglot', category: 'mastery', rarity: 'epic', progress: 0, target: 10 },
    { id: 'master-polyglot', title: 'Master Polyglot', description: 'Code in 20 different languages', icon: 'polyglot', category: 'mastery', rarity: 'epic', progress: 0, target: 20 },
    { id: 'master-builder', title: 'Master Builder', description: 'Write 10,000 lines of code', icon: 'master-builder', category: 'mastery', rarity: 'legendary', progress: 0, target: 10000 },
    { id: 'perfectionist', title: 'Perfectionist', description: 'Delete more lines than you write in a day', icon: 'perfectionist', category: 'mastery', rarity: 'rare', progress: 0, target: 1 },
    
    // Social category
    { id: 'team-player', title: 'Team Player', description: 'Work on multiple files in one session', icon: 'team-player', category: 'social', rarity: 'common', progress: 0, target: 3 },
    { id: 'consistent-contributor', title: 'Consistent Contributor', description: 'Code every day for a week', icon: 'consistent-contributor', category: 'social', rarity: 'rare', progress: 0, target: 7 },
    
    // Special category for the new achievements
    { id: 'midnight-hacker', title: 'Midnight Hacker', description: 'Code at exactly midnight', icon: 'midnight-hacker', category: 'special', rarity: 'epic', progress: 0, target: 1 },
    { id: 'bug-hunter', title: 'Bug Hunter', description: 'Delete 1000 lines (fixing bugs)', icon: 'bug-hunter', category: 'special', rarity: 'rare', progress: 0, target: 1000 },
    { id: 'weekend-grinder', title: 'Weekend Grinder', description: 'Code for 8 hours on a weekend', icon: 'weekend-grinder', category: 'special', rarity: 'legendary', progress: 0, target: 480 },
    
    // Pomodoro productivity achievements
    { id: 'first-pomodoro', title: 'First Focus', description: 'Complete your first Pomodoro session', icon: 'first-step.png', category: 'productivity', rarity: 'common', progress: 0, target: 1 },
    { id: 'pomodoro-quartet', title: 'Pomodoro Quartet', description: 'Complete 4 Pomodoro sessions in a row', icon: 'streak-warrior.png', category: 'productivity', rarity: 'rare', progress: 0, target: 4 },
    { id: 'pomodoro-master', title: 'Pomodoro Master', description: 'Complete 8 Pomodoro sessions in a row', icon: 'master-builder.png', category: 'productivity', rarity: 'epic', progress: 0, target: 8 },
    { id: 'focused-day', title: 'Focused Day', description: 'Complete 8+ Pomodoro sessions in one day', icon: 'perfectionist.png', category: 'productivity', rarity: 'epic', progress: 0, target: 8 },
    { id: 'pomodoro-veteran', title: 'Pomodoro Veteran', description: 'Complete 25 Pomodoro sessions', icon: 'medal.png', category: 'productivity', rarity: 'rare', progress: 0, target: 25 },
    { id: 'pomodoro-legend', title: 'Pomodoro Legend', description: 'Complete 100 Pomodoro sessions', icon: 'streak-legend.png', category: 'productivity', rarity: 'legendary', progress: 0, target: 100 },
    { id: 'pomodoro-champion', title: 'Pomodoro Champion', description: 'Complete 1000 Pomodoro sessions', icon: 'medal.png', category: 'productivity', rarity: 'champion', progress: 0, target: 200 },
    
    // Flow state achievements
    { id: 'flow-novice', title: 'Flow Novice', description: 'Achieve a flow score of 70+', icon: 'first-step.png', category: 'productivity', rarity: 'common', progress: 0, target: 70 },
    { id: 'flow-master', title: 'Flow Master', description: 'Achieve a flow score of 90+', icon: 'perfectionist.png', category: 'productivity', rarity: 'rare', progress: 0, target: 90 },
    { id: 'flow-legend', title: 'Flow Legend', description: 'Achieve perfect flow score (100)', icon: 'master-builder.png', category: 'productivity', rarity: 'legendary', progress: 0, target: 100 },
    { id: 'deep-focus', title: 'Deep Focus', description: 'Code for 60+ minutes without interruption', icon: 'perfectionist.png', category: 'productivity', rarity: 'epic', progress: 0, target: 60 },
    { id: 'focused-session', title: 'Laser Focused', description: 'Complete a session with only 1 file and no interruptions', icon: 'master-builder.png', category: 'productivity', rarity: 'rare', progress: 0, target: 1 }
  ];
}

function generateWeeklyChallenge(): WeeklyChallenge {
  const challenges = [
    { id: 'weekly-lines', title: 'Line Master', description: 'Write 500 lines this week', target: 500, type: 'lines' as const, reward: 1000 },
    { id: 'weekly-streak', title: 'Consistency King', description: 'Code every day this week', target: 7, type: 'streak' as const, reward: 1500 },
    { id: 'weekly-languages', title: 'Language Explorer', description: 'Code in 3 different languages', target: 3, type: 'languages' as const, reward: 800 },
    { id: 'weekly-time', title: 'Time Warrior', description: 'Code for 10 hours this week', target: 600, type: 'time' as const, reward: 1200 },
    { id: 'weekly-flow', title: 'Flow Master', description: 'Achieve 3 sessions with 80+ flow score', target: 3, type: 'flow' as const, reward: 1800 }
  ];
  
  const challenge = challenges[Math.floor(Math.random() * challenges.length)];
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of week
  
  return {
    ...challenge,
    progress: 0,
    weekStart: weekStart.toISOString().split('T')[0],
    completed: false
  };
}

function updateAchievements(stats: CodivaStats) {
  if (!stats.newAchievements || stats.newAchievements.length === 0) {
    stats.newAchievements = initializeAchievements();
  }
  
  const now = new Date();
  const today = toDateKey(now);
  const currentHour = now.getHours();
  
  // Update achievement progress
  stats.newAchievements.forEach(achievement => {
    switch (achievement.id) {
      case 'first-steps':
        achievement.progress = Math.min(100, stats.manualLines > 0 ? 100 : 0);
        break;
      case 'streak-warrior':
        achievement.progress = Math.min(100, (stats.streak / 7) * 100);
        break;
      case 'streak-legend':
        achievement.progress = Math.min(100, (stats.streak / 30) * 100);
        break;
      case 'century-streak':
        achievement.progress = Math.min(100, (stats.streak / 100) * 100);
        break;
      case 'yearly-streak':
        achievement.progress = Math.min(100, (stats.streak / 365) * 100);
        break;
      case 'speed-demon':
        const sessionLines = stats.currentSession?.lines || 0;
        achievement.progress = Math.min(100, (sessionLines / 100) * 100);
        break;
      case 'master-speed-demon':
        const sessionLines = stats.currentSession?.lines || 0;
        achievement.progress = Math.min(100, (sessionLines / 1000) * 100);
        break;
      case 'marathon-coder':
        const sessionTime = stats.currentSession ? 
          (new Date().getTime() - stats.currentSession.start.getTime()) / (1000 * 60) : 0;
        achievement.progress = Math.min(100, (sessionTime / 240) * 100);
        break;
      case 'early-bird':
        achievement.progress = currentHour < 6 && stats.manualLines > 0 ? 100 : achievement.progress;
        break;
      case 'polyglot':
        const languageCount = Object.keys(stats.languageStats).length;
        achievement.progress = Math.min(100, (languageCount / 5) * 100);
        break;
      case 'advanced-polyglot':
        const languageCount = Object.keys(stats.languageStats).length;
        achievement.progress = Math.min(100, (languageCount / 10) * 100);
        break;
      case 'master-polyglot':
        const languageCount = Object.keys(stats.languageStats).length;
        achievement.progress = Math.min(100, (languageCount / 20) * 100);
        break;
      case 'master-builder':
        achievement.progress = Math.min(100, (stats.manualLines / 10000) * 100);
        break;
      case 'midnight-hacker':
        achievement.progress = currentHour === 0 && stats.manualLines > 0 ? 100 : achievement.progress;
        break;
      case 'bug-hunter':
        achievement.progress = Math.min(100, (stats.deletedLines / 1000) * 100);
        break;
      case 'team-player':
        const filesInSession = stats.currentSession?.files.length || 0;
        achievement.progress = Math.min(100, (filesInSession / 3) * 100);
        break;
      
      // Pomodoro achievements
      case 'first-pomodoro':
        achievement.progress = stats.pomodoroStats.completedSessions > 0 ? 100 : 0;
        break;
      case 'pomodoro-quartet':
        achievement.progress = Math.min(100, (stats.pomodoroStats.currentStreak / 4) * 100);
        break;
      case 'pomodoro-master':
        achievement.progress = Math.min(100, (stats.pomodoroStats.currentStreak / 8) * 100);
        break;
      case 'focused-day':
        achievement.progress = Math.min(100, (stats.pomodoroStats.todaySessions / 8) * 100);
        break;
      case 'pomodoro-veteran':
        achievement.progress = Math.min(100, (stats.pomodoroStats.completedSessions / 25) * 100);
        break;
      case 'pomodoro-legend':
        achievement.progress = Math.min(100, (stats.pomodoroStats.completedSessions / 100) * 100);
        break;
        
      // Flow state achievements
      case 'flow-novice':
        const currentFlowScore = stats.currentSession?.flowMetrics?.flowScore || 0;
        achievement.progress = currentFlowScore >= 70 ? 100 : Math.min(100, (currentFlowScore / 70) * 100);
        break;
      case 'flow-master':
        const masterFlowScore = stats.currentSession?.flowMetrics?.flowScore || 0;
        achievement.progress = masterFlowScore >= 90 ? 100 : Math.min(100, (masterFlowScore / 90) * 100);
        break;
      case 'flow-legend':
        const legendFlowScore = stats.currentSession?.flowMetrics?.flowScore || 0;
        achievement.progress = legendFlowScore >= 100 ? 100 : Math.min(100, legendFlowScore);
        break;
      case 'deep-focus':
        const longestBurst = stats.currentSession?.flowMetrics?.longestBurst || 0;
        achievement.progress = longestBurst >= 60 ? 100 : Math.min(100, (longestBurst / 60) * 100);
        break;
      case 'focused-session':
        const sessionFiles = stats.currentSession?.files.length || 0;
        const sessionInterruptions = stats.currentSession?.flowMetrics?.interruptions || 1;
        const isFocused = sessionFiles === 1 && sessionInterruptions === 0;
        achievement.progress = isFocused ? 100 : 0;
        break;
    }
    
    // Mark as unlocked if progress reaches 100%
    if (achievement.progress >= 100 && !achievement.unlockedAt) {
      achievement.unlockedAt = now;
      // Show notification
      vscode.window.showInformationMessage(
        `⭐ Achievement Unlocked: ${achievement.title}! +${achievement.target * 10} XP & +1 Star`,
        'View Dashboard'
      ).then(selection => {
        if (selection) {
          vscode.commands.executeCommand('codiva.showDashboard');
        }
      });
      stats.xp += achievement.target * 10;
      stats.totalXp += achievement.target * 10;
    }
  });
}

function updateWeeklyChallenge(stats: CodivaStats) {
  const now = new Date();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const currentWeekStart = weekStart.toISOString().split('T')[0];
  
  // Create new challenge if none exists or week changed
  if (!stats.weeklyChallenge || stats.weeklyChallenge.weekStart !== currentWeekStart) {
    stats.weeklyChallenge = generateWeeklyChallenge();
    stats.weeklyChallenge.weekStart = currentWeekStart;
  }
  
  const challenge = stats.weeklyChallenge;
  if (challenge.completed) return;
  
  // Update progress based on challenge type
  switch (challenge.type) {
    case 'lines':
      const weekLines = Object.entries(stats.history)
        .filter(([date]) => date >= currentWeekStart)
        .reduce((sum, [, record]) => sum + record.added, 0);
      challenge.progress = weekLines;
      break;
    case 'streak':
      challenge.progress = Math.min(7, stats.streak);
      break;
    case 'languages':
      const weekLanguages = new Set();
      Object.entries(stats.history)
        .filter(([date]) => date >= currentWeekStart)
        .forEach(([, record]) => {
          Object.keys(record.languages || {}).forEach(lang => weekLanguages.add(lang));
        });
      challenge.progress = weekLanguages.size;
      break;
    case 'time':
      const weekTime = Object.entries(stats.history)
        .filter(([date]) => date >= currentWeekStart)
        .reduce((sum, [, record]) => sum + record.timeSpent, 0);
      challenge.progress = weekTime;
      break;
    case 'flow':
      // Count sessions with flow score >= 80 this week
      // Note: This is a simplified approach - in a full implementation, 
      // you might want to store session history with flow scores
      const currentFlowScore = stats.currentSession?.flowMetrics?.flowScore || 0;
      const weekFlowSessions = currentFlowScore >= 80 ? 1 : 0; // Simplified for demo
      challenge.progress = weekFlowSessions;
      break;
  }
  
  // Check completion
  if (challenge.progress >= challenge.target && !challenge.completed) {
    challenge.completed = true;
    vscode.window.showInformationMessage(
      `Weekly Challenge Complete: ${challenge.title}! +${challenge.reward} XP`,
      'View Dashboard'
    ).then(selection => {
      if (selection) {
        vscode.commands.executeCommand('codiva.showDashboard');
      }
    });
    stats.xp += challenge.reward;
    stats.totalXp += challenge.reward;
  }
}

// GitHub-style heatmap data generation with detailed info
function generateHeatmapData(history: Record<string, DayRecord>, days: number = 365): Array<{date: string, count: number, level: number, timeSpent: number, sessions: number}> {
  const data = [];
  const today = new Date();
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const key = toDateKey(date);
    const record = history[key];
    const count = record ? record.added : 0;
    const timeSpent = record ? record.timeSpent : 0;
    const sessions = record ? record.sessions : 0;
    let level = 0;
    if (count > 0 || timeSpent > 0) level = 1;
    if (count >= 5 || timeSpent >= 30) level = 2;
    if (count >= 15 || timeSpent >= 60) level = 3;
    if (count >= 30 || timeSpent >= 120) level = 4;
    
    data.push({
      date: key,
      count,
      level,
      timeSpent,
      sessions
    });
  }
  
  return data;
}

function computeImprovementSnapshot(stats: CodivaStats): ImprovementSnapshot {
  const history = stats.history || {};
  const pomodoros = stats.pomodoroHistory || [];
  const today = new Date();

  const aggregateRange = (startOffset: number, endOffset: number) => {
    let lines = 0;
    let time = 0;
    let sessions = 0;
    for (let offset = startOffset; offset < endOffset; offset++) {
      const date = new Date(today);
      date.setDate(date.getDate() - offset);
      const key = toDateKey(date);
      const record = history[key];
      if (record) {
        lines += record.added || 0;
        time += record.timeSpent || 0;
        sessions += record.sessions || 0;
      }
    }
    return { lines, time, sessions };
  };

  const countPomodoros = (startOffset: number, endOffset: number) => {
    if (!Array.isArray(pomodoros) || pomodoros.length === 0) {
      return 0;
    }
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - endOffset + 1);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - startOffset);
    return pomodoros.filter((session) => {
      if (!session || session.type !== 'work' || !session.completed) {
        return false;
      }
      const completedAt = session.end ?? session.start;
      if (!completedAt) {
        return false;
      }
      return completedAt >= startDate && completedAt <= endDate;
    }).length;
  };

  const toPercent = (current: number, previous: number): number => {
    if (previous <= 0) {
      return current > 0 ? 100 : 0;
    }
    const pct = ((current - previous) / previous) * 100;
    return Math.max(-999, Math.min(999, Math.round(pct)));
  };

  const last14Days: Array<{ date: string; lines: number; timeSpent: number; sessions: number }> = [];
  let bestDay: { date: string; lines: number } | undefined;

  for (let offset = 13; offset >= 0; offset--) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    const key = toDateKey(date);
    const record = history[key];
    const lines = record?.added ?? 0;
    const timeSpent = record?.timeSpent ?? 0;
    const sessions = record?.sessions ?? 0;
    last14Days.push({ date: key, lines, timeSpent, sessions });
    if (!bestDay || lines > bestDay.lines) {
      bestDay = { date: key, lines };
    }
  }

  const currentWeek = aggregateRange(0, 7);
  const previousWeek = aggregateRange(7, 14);

  const currentWorkPomodoros = countPomodoros(0, 7);
  const previousWorkPomodoros = countPomodoros(7, 14);

  return {
    last14Days,
    weekComparison: {
      currentLines: currentWeek.lines,
      previousLines: previousWeek.lines,
      linesDelta: currentWeek.lines - previousWeek.lines,
      linesPercent: toPercent(currentWeek.lines, previousWeek.lines),
      currentTime: currentWeek.time,
      previousTime: previousWeek.time,
      timeDelta: currentWeek.time - previousWeek.time,
      timePercent: toPercent(currentWeek.time, previousWeek.time),
      currentSessions: currentWeek.sessions,
      previousSessions: previousWeek.sessions,
      sessionDelta: currentWeek.sessions - previousWeek.sessions,
      sessionPercent: toPercent(currentWeek.sessions, previousWeek.sessions)
    },
    pomodoroComparison: {
      currentWork: currentWorkPomodoros,
      previousWork: previousWorkPomodoros,
      delta: currentWorkPomodoros - previousWorkPomodoros,
      percent: toPercent(currentWorkPomodoros, previousWorkPomodoros)
    },
    bestDay
  };
}

function evaluateAchievements(stats: CodivaStats, now: Date) {
  stats.badges = stats.badges ?? [];

  const setLevel = (id: string, level: number) => {
    const b = stats.badges.find(x => x.id === id);
    if (!b) stats.badges.push({ id, level, unlockedAt: new Date() });
    else if (level > b.level) {
      b.level = level;
      b.unlockedAt = new Date();
    }
  };

  // Manual Mastery achievement
  const manual = stats.manualLines;
  if (manual >= 10000) setLevel('manual-mastery', 3);
  else if (manual >= 1000) setLevel('manual-mastery', 2);
  else if (manual >= 100) setLevel('manual-mastery', 1);

  // Bug Slayer achievement
  const del = stats.deletedLines ?? 0;
  if (del >= 1000) setLevel('bug-slayer', 3);
  else if (del >= 500) setLevel('bug-slayer', 2);
  else if (del >= 100) setLevel('bug-slayer', 1);

  // Streaker achievement
  const st = stats.streak;
  if (st >= 30) setLevel('streaker', 3);
  else if (st >= 7) setLevel('streaker', 2);
  else if (st >= 3) setLevel('streaker', 1);

  // Night Owl achievement
  if (now.getHours() < 5) setLevel('night-owl', 1);
}

function badgeName(id: string): string {
  switch (id) {
    case 'manual-mastery': return 'Manual Mastery';
    case 'bug-slayer': return 'Bug Slayer';
    case 'streaker': return 'Streaker';
    case 'night-owl': return 'Night Owl';
    default: return id;
  }
}

function createDefaultStats(): CodivaStats {
  return {
    // User Profile
    isFirstTime: true,
    
    // Core stats 
    manualLines: 0,
    xp: 0,
    totalXp: 0,
    level: 1,
    streak: 0,
    maxStreak: 0,
    lastCoded: null,
    
    // Legacy
    achievements: [],
    deletedLines: 0,
    
    // Enhanced tracking
    badges: [],
    newAchievements: [],
    history: {},
    languageStats: {},
    projectStats: {},
    totalSessions: 0,
    totalTimeSpent: 0,
    averageSessionLength: 0,
    
    // Anti-spam tracking
    recentChanges: [],
    
    // Social & gamification
    consecutiveDays: 0,
    weeklyGoal: 70, 
    dailyGoal: 10,
    perfectWeeks: 0,
    longestSession: 0,
    favoriteLanguage: 'typescript',
    
    // Analytics
    mostProductiveHour: 14, // 2 PM default
    codingDays: 0,
    averageXpPerDay: 0,
    
    // Pomodoro tracking
    pomodoroStats: {
      totalSessions: 0,
      completedSessions: 0,
      totalWorkTime: 0,
      totalBreakTime: 0,
      longestStreak: 0,
      currentStreak: 0,
      todaySessions: 0,
      weekSessions: 0,
      averageSessionsPerDay: 0
    },
    pomodoroHistory: [],
    currentPomodoro: undefined
  };
}

function loadStats(context: vscode.ExtensionContext): CodivaStats {
  try {
    const raw = context.globalState.get<any>('codiva.stats');
    if (!raw) {
      return createDefaultStats();
    }
    
    const defaults = createDefaultStats();
    
    // Validate critical data types to prevent corruption
    const safeNumber = (val: any, defaultVal: number): number => {
      const num = Number(val);
      return isNaN(num) || !isFinite(num) ? defaultVal : num;
    };
    
    const safeArray = (val: any, defaultVal: any[]): any[] => {
      return Array.isArray(val) ? val : defaultVal;
    };
    
    const safeObject = (val: any, defaultVal: object): object => {
      return val && typeof val === 'object' && !Array.isArray(val) ? val : defaultVal;
    };
    
    return {
      ...defaults,
      // User profile with validation
      userName: typeof raw.userName === 'string' ? raw.userName : undefined,
      isFirstTime: typeof raw.isFirstTime === 'boolean' ? raw.isFirstTime : (raw.userName ? false : true),
      
      // Core stats with safe number conversion
      manualLines: safeNumber(raw.manualLines, 0),
      xp: safeNumber(raw.xp, 0),
      level: Math.max(1, safeNumber(raw.level, 1)), // Level must be at least 1
      totalXp: safeNumber(raw.totalXp, 0),
      streak: safeNumber(raw.streak, 0),
      maxStreak: safeNumber(raw.maxStreak, 0),
      lastCoded: raw.lastCoded ? new Date(raw.lastCoded) : null,
      achievements: safeArray(raw.achievements, []),
      badges: safeArray(raw.badges, []).map((b: any) => ({
        ...b,
        unlockedAt: b.unlockedAt ? new Date(b.unlockedAt) : new Date()
      })),
      deletedLines: safeNumber(raw.deletedLines, 0),
      history: safeObject(raw.history, {}),
      languageStats: safeObject(raw.languageStats, {}),
      newAchievements: safeArray(raw.newAchievements, []),
      totalSessions: safeNumber(raw.totalSessions, 0),
      totalTimeSpent: safeNumber(raw.totalTimeSpent, 0),
      
      // Anti-spam tracking with size limits
      recentChanges: safeArray(raw.recentChanges, []).slice(-10), // Keep only last 10
      
      // Social & gamification with validation
      weeklyGoal: safeNumber(raw.weeklyGoal, defaults.weeklyGoal),
      dailyGoal: safeNumber(raw.dailyGoal, defaults.dailyGoal),
      perfectWeeks: safeNumber(raw.perfectWeeks, 0),
      longestSession: safeNumber(raw.longestSession, 0),
      favoriteLanguage: typeof raw.favoriteLanguage === 'string' ? raw.favoriteLanguage : defaults.favoriteLanguage,
      mostProductiveHour: Math.max(0, Math.min(23, safeNumber(raw.mostProductiveHour, defaults.mostProductiveHour))),
      codingDays: safeNumber(raw.codingDays, 0),
      averageXpPerDay: safeNumber(raw.averageXpPerDay, 0),
      
      // Pomodoro tracking with safe defaults
      pomodoroStats: raw.pomodoroStats ? {
        totalSessions: safeNumber(raw.pomodoroStats.totalSessions, 0),
        completedSessions: safeNumber(raw.pomodoroStats.completedSessions, 0),
        totalWorkTime: safeNumber(raw.pomodoroStats.totalWorkTime, 0),
        totalBreakTime: safeNumber(raw.pomodoroStats.totalBreakTime, 0),
        longestStreak: safeNumber(raw.pomodoroStats.longestStreak, 0),
        currentStreak: safeNumber(raw.pomodoroStats.currentStreak, 0),
        todaySessions: safeNumber(raw.pomodoroStats.todaySessions, 0),
        weekSessions: safeNumber(raw.pomodoroStats.weekSessions, 0),
        averageSessionsPerDay: safeNumber(raw.pomodoroStats.averageSessionsPerDay, 0),
        lastSessionDate: raw.pomodoroStats.lastSessionDate ? new Date(raw.pomodoroStats.lastSessionDate) : undefined
      } : defaults.pomodoroStats,
      pomodoroHistory: safeArray(raw.pomodoroHistory, []).map((session: any) => ({
        ...session,
        start: session.start ? new Date(session.start) : new Date(),
        end: session.end ? new Date(session.end) : undefined,
        pausedAt: session.pausedAt ? new Date(session.pausedAt) : undefined,
        remainingSeconds: safeNumber(session.remainingSeconds, 0)
      })),
      currentPomodoro: raw.currentPomodoro ? {
        ...raw.currentPomodoro,
        start: new Date(raw.currentPomodoro.start),
        end: raw.currentPomodoro.end ? new Date(raw.currentPomodoro.end) : undefined,
        pausedAt: raw.currentPomodoro.pausedAt ? new Date(raw.currentPomodoro.pausedAt) : undefined,
        remainingSeconds: safeNumber(raw.currentPomodoro.remainingSeconds, (raw.currentPomodoro.duration || 0) * 60)
      } : undefined,
      
      // Project tracking with safe defaults
      projectStats: safeObject(raw.projectStats, {}),
      currentProject: typeof raw.currentProject === 'string' ? raw.currentProject : undefined
    } as CodivaStats;
  } catch (error) {
    console.error('Codiva: Error loading stats, using defaults:', error);
    vscode.window.showWarningMessage('Codiva: Error loading previous data, starting fresh.');
    return createDefaultStats();
  }
}

function saveStats(context: vscode.ExtensionContext, stats: CodivaStats) {
  try {
    // Create a complete serializable object
    const serializable = {
      // User profile
      userName: stats.userName,
      isFirstTime: stats.isFirstTime,
      
      // Core stats
      manualLines: stats.manualLines,
      xp: stats.xp,
      level: stats.level,
      totalXp: stats.totalXp,
      streak: stats.streak,
      maxStreak: stats.maxStreak,
      lastCoded: stats.lastCoded ? stats.lastCoded.getTime() : null,
      
      // Legacy compatibility
      achievements: stats.achievements,
      deletedLines: stats.deletedLines,
      
      // Enhanced tracking
      badges: stats.badges,
      newAchievements: stats.newAchievements,
      weeklyChallenge: stats.weeklyChallenge,
      history: stats.history,
      languageStats: stats.languageStats,
      totalSessions: stats.totalSessions,
      totalTimeSpent: stats.totalTimeSpent,
      
      // Anti-spam tracking
      recentChanges: stats.recentChanges.slice(-10),
      
      // Social & gamification
      consecutiveDays: stats.consecutiveDays,
      weeklyGoal: stats.weeklyGoal,
      dailyGoal: stats.dailyGoal,
      perfectWeeks: stats.perfectWeeks,
      longestSession: stats.longestSession,
      favoriteLanguage: stats.favoriteLanguage,
      mostProductiveHour: stats.mostProductiveHour,
      codingDays: stats.codingDays,
      averageXpPerDay: stats.averageXpPerDay,
      
      // Pomodoro tracking
      pomodoroStats: stats.pomodoroStats,
      pomodoroHistory: stats.pomodoroHistory,
      currentPomodoro: stats.currentPomodoro,
      
      // Project tracking
      projectStats: stats.projectStats,
      currentProject: stats.currentProject
    };
    
    // Check data size to prevent storage issues
    const dataSize = JSON.stringify(serializable).length;
    const maxSize = 1024 * 1024; // 1MB limit to save
    
    if (dataSize > maxSize) {
      console.warn(`Codiva: Data size (${dataSize} bytes) exceeds recommended limit. Cleaning up history...`);
      
      const now = new Date();
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      const cleanedHistory: Record<string, DayRecord> = {};
      
      Object.entries(serializable.history).forEach(([key, value]) => {
        const date = new Date(key);
        if (date > oneYearAgo) {
          cleanedHistory[key] = value;
        }
      });
      
      serializable.history = cleanedHistory;
    }
    
    context.globalState.update('codiva.stats', serializable);
    
  } catch (error) {
    console.error('Codiva: Error saving stats:', error);
    
    // Try to save minimal critical data if full save fails
    try {
      const minimalData = {
        userName: stats.userName,
        manualLines: stats.manualLines,
        xp: stats.xp,
        level: stats.level,
        streak: stats.streak,
        lastCoded: stats.lastCoded ? stats.lastCoded.getTime() : null
      };
      context.globalState.update('codiva.stats', minimalData);
      vscode.window.showWarningMessage('Codiva: Saved minimal progress data. Some features may reset.');
    } catch (criticalError) {
      console.error('Codiva: Critical error saving minimal stats:', criticalError);
      vscode.window.showErrorMessage('Codiva: Failed to save progress. Please check VS Code storage permissions.');
    }
  }
}
//the Pomodoro Timer:

function beginPomodoroCountdown(context: vscode.ExtensionContext, session: PomodoroSession, startSeconds: number) {
  if (pomodoroTimer) {
    clearInterval(pomodoroTimer);
  }

  pomodoroRemainingSeconds = Math.max(0, startSeconds);
  session.remainingSeconds = pomodoroRemainingSeconds;
  session.state = 'running';
  session.pausedAt = undefined;

  updatePomodoroStatusBar(pomodoroRemainingSeconds);

  if (pomodoroRemainingSeconds === 0) {
    completePomodoroSession(context, session);
    return;
  }

  pomodoroTimer = setInterval(() => {
    if (pomodoroRemainingSeconds === undefined) {
      return;
    }

    pomodoroRemainingSeconds = Math.max(0, pomodoroRemainingSeconds - 1);
    session.remainingSeconds = pomodoroRemainingSeconds;
    updatePomodoroStatusBar(pomodoroRemainingSeconds);

    if (pomodoroRemainingSeconds <= 0) {
      completePomodoroSession(context, session);
    }
  }, 1000);
}

async function startPomodoro(context: vscode.ExtensionContext, type: 'work' | 'shortBreak' | 'longBreak', duration: number) {
  // Reset any existing timer first
  if (pomodoroTimer) {
    clearInterval(pomodoroTimer);
  }


  let task: string | undefined;
  if (type === 'work') {
    task = await vscode.window.showInputBox({
      prompt: 'What will you work on? (optional)',
      placeHolder: 'e.g., Fix login bug, Implement user auth...'
    });
  }

  const sessionId = Date.now().toString();
  const session: PomodoroSession = {
    id: sessionId,
    start: new Date(),
    duration,
    type,
    completed: false,
    task
  };

  stats.currentPomodoro = session;
  stats.pomodoroStats.totalSessions++;
  session.state = 'running';
  
  // Update daily and weekly counters
  const today = toDateKey(new Date());
  const lastSessionDate = stats.pomodoroStats.lastSessionDate;
  if (!lastSessionDate || toDateKey(lastSessionDate) !== today) {
    stats.pomodoroStats.todaySessions = 1;
  } else {
    stats.pomodoroStats.todaySessions++;
  }
  
  stats.pomodoroStats.lastSessionDate = new Date();
  
  beginPomodoroCountdown(context, session, duration * 60);

  // Show notification
  const typeDisplay = type === 'work' ? 'Work' : type === 'shortBreak' ? 'Short Break' : 'Long Break';
  vscode.window.showInformationMessage(
    `🍅 ${typeDisplay} session started (${duration} min)${task ? ` - ${task}` : ''}`,
    'Stop'
  ).then(selection => {
    if (selection === 'Stop') {
      stopPomodoro(context);
    }
  });

  saveStats(context, stats);
}

async function pausePomodoro(context: vscode.ExtensionContext) {
  const session = stats.currentPomodoro;
  if (!session) {
    vscode.window.showWarningMessage('No active Pomodoro session to pause');
    return;
  }

  if (session.state === 'paused') {
    vscode.window.showInformationMessage('Pomodoro is already paused');
    return;
  }

  if (pomodoroTimer) {
    clearInterval(pomodoroTimer);
    pomodoroTimer = undefined;
  } else if (pomodoroRemainingSeconds === undefined) {
    vscode.window.showWarningMessage('Pomodoro timer is not running');
    return;
  }

  const remaining = Math.max(0, pomodoroRemainingSeconds ?? session.remainingSeconds ?? session.duration * 60);
  pomodoroRemainingSeconds = remaining;
  session.remainingSeconds = remaining;
  session.state = 'paused';
  session.pausedAt = new Date();
  updatePomodoroStatusBar(remaining);
  saveStats(context, stats);
  
  vscode.window.showInformationMessage('⏸️ Pomodoro paused', 'Resume', 'Stop').then(selection => {
    if (selection === 'Resume') {
      vscode.commands.executeCommand('codiva.resumePomodoro');
    } else if (selection === 'Stop') {
      stopPomodoro(context);
    }
  });
}

async function resumePomodoro(context: vscode.ExtensionContext) {
  const session = stats.currentPomodoro;
  if (!session) {
    vscode.window.showWarningMessage('No paused Pomodoro session to resume');
    return;
  }

  if (session.state !== 'paused') {
    vscode.window.showInformationMessage('Current Pomodoro is already running');
    return;
  }

  const remaining = Math.max(0, pomodoroRemainingSeconds ?? session.remainingSeconds ?? session.duration * 60);
  if (remaining <= 0) {
    vscode.window.showWarningMessage('Nothing left to resume — start a fresh Pomodoro');
    return;
  }

  beginPomodoroCountdown(context, session, remaining);
  saveStats(context, stats);

  const typeDisplay = session.type === 'work' ? 'Work' : session.type === 'shortBreak' ? 'Short Break' : 'Long Break';
  vscode.window.showInformationMessage(`▶️ ${typeDisplay} session resumed`, 'Stop').then(selection => {
    if (selection === 'Stop') {
      stopPomodoro(context);
    }
  });
}

async function stopPomodoro(context: vscode.ExtensionContext) {
  if (!stats.currentPomodoro) {
    vscode.window.showWarningMessage('No active Pomodoro session to stop');
    return;
  }

  if (pomodoroTimer) {
    clearInterval(pomodoroTimer);
    pomodoroTimer = undefined;
  }

  const session = stats.currentPomodoro;
  const remaining = Math.max(0, pomodoroRemainingSeconds ?? session.remainingSeconds ?? session.duration * 60);
  pomodoroRemainingSeconds = undefined;
  session.end = new Date();
  session.interrupted = true;
  session.remainingSeconds = remaining;
  session.state = 'stopped';
  session.pausedAt = undefined;
  
  stats.pomodoroHistory.push(session);
  stats.currentPomodoro = undefined;
  
  updatePomodoroStatusBar();
  vscode.window.showInformationMessage('🛑 Pomodoro session stopped');
  
  saveStats(context, stats);
}

function completePomodoroSession(context: vscode.ExtensionContext, session: PomodoroSession) {
  if (pomodoroTimer) {
    clearInterval(pomodoroTimer);
    pomodoroTimer = undefined;
  }

  pomodoroRemainingSeconds = undefined;

  session.end = new Date();
  session.completed = true;
  session.state = 'completed';
  session.pausedAt = undefined;
  session.remainingSeconds = 0;
  
  stats.pomodoroStats.completedSessions++;
  stats.pomodoroStats.currentStreak++;
  stats.pomodoroStats.longestStreak = Math.max(stats.pomodoroStats.longestStreak, stats.pomodoroStats.currentStreak);
  
  if (session.type === 'work') {
    stats.pomodoroStats.totalWorkTime += session.duration;
    stats.xp += 50; // bonus +50 XP for completed pomodoro
    stats.totalXp += 50;
    queueCelebration({
      type: 'pomodoro',
      message: '🍅 Pomodoro complete! +50 XP',
      effect: 'pulse',
      highlightSelector: '#pomodoroCard',
      detail: { duration: session.duration }
    });
  } else {
    stats.pomodoroStats.totalBreakTime += session.duration;
  }
  
  stats.pomodoroHistory.push(session);
  stats.currentPomodoro = undefined;
  
  // Check for achievements related to Pomodoros
  updatePomodoroAchievements();
  
  updatePomodoroStatusBar();
  updateStatusBar(); // Update main status bar for XP gain 
  
  const typeDisplay = session.type === 'work' ? 'Work' : session.type === 'shortBreak' ? 'Short Break' : 'Long Break';
  const message = session.type === 'work' ? 
    `🎉 ${typeDisplay} session completed! +50 XP` : 
    `✅ ${typeDisplay} completed!`;
  
  vscode.window.showInformationMessage(message, 'Start Next').then(selection => {
    if (selection === 'Start Next') {
      if (session.type === 'work') {
        const completedWork = stats.pomodoroStats.completedSessions;
        const nextType = completedWork % 4 === 0 ? 'longBreak' : 'shortBreak';
        const duration = nextType === 'longBreak' ? 15 : 5;
        startPomodoro(context, nextType, duration);
      } else {
        startPomodoro(context, 'work', 25);
      }
    }
  });
  
  saveStats(context, stats);
}

function updatePomodoroStatusBar(remainingSeconds?: number) {
  if (!pomodoroStatusBarItem) return;

  const session = stats.currentPomodoro;
  const format = (totalSeconds: number) => {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (session && (session.state === 'running' || session.state === undefined)) {
    const secondsLeft = remainingSeconds ?? pomodoroRemainingSeconds ?? session.remainingSeconds ?? session.duration * 60;
    const typeIcon = session.type === 'work' ? '🍅' : '☕';
    pomodoroStatusBarItem.text = `${typeIcon} ${format(secondsLeft)}`;
    pomodoroStatusBarItem.tooltip = `Pomodoro: ${session.type} session${session.task ? ' - ' + session.task : ''}`;
    pomodoroStatusBarItem.command = 'codiva.pausePomodoro';
    pomodoroStatusBarItem.show();
    return;
  }

  if (session && session.state === 'paused') {
    const secondsLeft = remainingSeconds ?? pomodoroRemainingSeconds ?? session.remainingSeconds ?? session.duration * 60;
    pomodoroStatusBarItem.text = `⏸️ ${format(secondsLeft)}`;
    pomodoroStatusBarItem.tooltip = `Pomodoro paused${session.task ? ' - ' + session.task : ''}`;
    pomodoroStatusBarItem.command = 'codiva.resumePomodoro';
    pomodoroStatusBarItem.show();
    return;
  }

  const todaySessions = stats.pomodoroStats.todaySessions;
  pomodoroStatusBarItem.text = `🍅 ${todaySessions}`;
  pomodoroStatusBarItem.tooltip = `Pomodoros today: ${todaySessions}\nClick to start a work session`;
  pomodoroStatusBarItem.command = 'codiva.startPomodoro';
  pomodoroStatusBarItem.show();
}

function updatePomodoroAchievements() {
  const achievements = stats.newAchievements;
  const pomodoroStats = stats.pomodoroStats;
  
  const addPomodoroAchievement = (achievement: Achievement) => {
    const existing = achievements.find(a => a.id === achievement.id);
    if (!existing) {
      achievements.push(achievement);
    } else if (!existing.unlockedAt && achievement.unlockedAt) {
      existing.unlockedAt = achievement.unlockedAt;
      existing.progress = 100;
    }
  };
  
  // First Pomodoro
  if (pomodoroStats.completedSessions === 1) {
    addPomodoroAchievement({
      id: 'first-pomodoro',
      title: 'First Focus',
      description: 'Complete your first Pomodoro session',
      icon: 'first-step.png',
      category: 'productivity',
      rarity: 'common',
      progress: 100,
      target: 1,
      unlockedAt: new Date()
    });
  }
  
  // Pomodoro streak achievements
  if (pomodoroStats.currentStreak === 4) {
    addPomodoroAchievement({
      id: 'pomodoro-quartet',
      title: 'Pomodoro Quartet',
      description: 'Complete 4 Pomodoro sessions in a row',
      icon: 'streak-warrior.png',
      category: 'productivity',
      rarity: 'rare',
      progress: 100,
      target: 4,
      unlockedAt: new Date()
    });
  }
  
  if (pomodoroStats.currentStreak === 8) {
    addPomodoroAchievement({
      id: 'pomodoro-master',
      title: 'Pomodoro Master',
      description: 'Complete 8 Pomodoro sessions in a row',
      icon: 'master-builder.png',
      category: 'productivity',
      rarity: 'epic',
      progress: 100,
      target: 8,
      unlockedAt: new Date()
    });

  }
  
  // Pomodor achievements
  if (pomodoroStats.todaySessions >= 8) {
    addPomodoroAchievement({
      id: 'focused-day',
      title: 'Focused Day',
      description: 'Complete 8+ Pomodoro sessions in one day',
      icon: 'perfectionist.png',
      category: 'productivity',
      rarity: 'epic',
      progress: 100,
      target: 8,
      unlockedAt: new Date()
    });
  }
  
  // Pomodor achievements
  if (pomodoroStats.completedSessions === 25) {
    addPomodoroAchievement({
      id: 'pomodoro-veteran',
      title: 'Pomodoro Veteran',
      description: 'Complete 25 Pomodoro sessions',
      icon: 'medal.png',
      category: 'productivity',
      rarity: 'rare',
      progress: 100,
      target: 25,
      unlockedAt: new Date()
    });
  }
  
  if (pomodoroStats.completedSessions === 100) {
    addPomodoroAchievement({
      id: 'pomodoro-legend',
      title: 'Pomodoro Legend',
      description: 'Complete 100 Pomodoro sessions',
      icon: 'streak-legend.png',
      category: 'productivity',
      rarity: 'legendary',
      progress: 100,
      target: 100,
      unlockedAt: new Date()
    });
  }
    if (pomodoroStats.completedSessions === 1000) {
      addPomodoroAchievement({
        id: 'pomodoro-champion',
        title: 'Pomodoro Champion',
        description: 'Complete 1000 Pomodoro sessions',
        icon: 'champion.png',
        category: 'productivity',
        rarity: 'champion',
        progress: 1000,
        target: 1000,
        unlockedAt: new Date()
      });
    }

}

export function deactivate() {
  if (pomodoroTimer) {
    clearInterval(pomodoroTimer);
    pomodoroTimer = undefined;
  }
}
