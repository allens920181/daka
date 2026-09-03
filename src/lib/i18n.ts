/**
 * 語言包。zh 是來源，en 由型別強制必須有相同的鍵——
 * 舊版是逐一 querySelector 改文字，加一個字串就漏一個地方，這裡讓編譯器擋住。
 */
const zh = {
  appName: 'RollRoom',
  tagline: '大家一起點同一份名單',

  // 首頁
  openRoom: '開啟空間',
  joinRoom: '加入空間',
  /* 標籤問問題，placeholder 給例子。原本兩處共用同一個字串，19 字的問句上下相隔
     20px 完整重複兩遍。重複的是例子，不是問句，所以例子搬到 placeholder 就結案。 */
  roomNameLabel: '這場活動叫什麼？',
  roomNamePlaceholder: '例如：秋季旅遊 · 出發',
  codePlaceholder: '輸入 6 碼代碼',
  recentRooms: '最近的空間',
  noRecentRooms: '還沒有開過空間。開一個，或用代碼加入別人的。',
  owner: '我開的',
  helper: '協助點名',
  create: '建立',
  join: '加入',
  forget: '從清單移除',

  // 名單
  roster: '名單',
  pasteRoster: '貼上名單',
  /* 格式細節從說明搬到範例：讀四行字才知道能貼什麼，不如按一下直接看到解析結果。 */
  pastePlaceholder: '一行一個名字，LINE 接龍直接貼就行。',
  /* 範例填的是整張表：活動名稱一格、名單一份，按一下就看得到一個完整的空間
     長什麼樣。key 依語意命名（§6.4），所以不叫 paste*——它已經不屬於哪一個欄位。 */
  exampleFill: '填入範例',
  exampleClear: '清除範例',
  exampleName: '秋季旅遊 · 出發',
  /* 範例的每一行都必須解析得出一個人（parse.test.ts 會驗）。分組標題不放進來——
     預覽不顯示分組，貼進去會有兩行憑空消失，那是在示範一件看不到的事。 */
  exampleRoster: '1.王小明 0912345678\n2. 李美花 +1\n3、陳大同（請假）\n４．張三\n- 李四\n王五 帶2人',
  /** 撥號鍵下面那行小字：這個號碼是從備註裡認出來的，不是填好的欄位。 */
  fromNote: '備註裡的號碼',
  parsePreview: '解析結果',
  /* 左邊的 label 已經是「解析結果」，不必再說一次「解析出」。
     「人次」不是贅詞而是單位標記：9 是列數、12 是人頭數，全站最容易搞混的兩個量。 */
  parsedCount: '{n} 人',
  parsedHeads: '含攜伴 {n} 人次',
  duplicateWarning: '有同名的人：{names}。點一個不會動到另一個，建議加註記區分。',
  skippedLines: '{n} 行看起來不是姓名，已略過',
  emptyRoster: '請先貼上名單',
  savedRosters: '常用名單',
  saveAsRoster: '存成常用名單',
  saveRosterPrompt: '這份常用名單叫什麼？',
  useRoster: '套用',
  deleteRoster: '刪除',
  noSavedRosters: '還沒有常用名單。名單載入後可以存起來，下次直接套用。',

  // 點名
  missing: '未到',
  arrived: '已到',
  excused: '請假',
  all: '全部',
  searchPlaceholder: '搜尋姓名…',
  allHere: '全部到齊',
  /* 頂欄接手計分區時要跟計分區逐字相同（大字＋「位沒到」）。這個 key 也用在
     結束後的橫幅，事情都結束了，「還有」本來就不該在那裡。 */
  missingCount: '{n} 位沒到',
  /** 計分區的大數字自己就是數量，標籤只補單位，不再把數字寫第二次。 */
  missingUnit: '位沒到',
  headcount: '{arrived} / {total} 人',
  withCompanions: '＋{n}',
  markArrived: '標記已到',
  markMissing: '改回未到',
  markExcused: '標記請假',
  undo: '復原',
  undone: '已復原',
  checkedBy: '{name} 於 {time}',
  at: '{time}',
  emptyList: '這裡沒有人',
  emptyMissing: '太好了，全部都到了',
  emptySearchHint: '還有 {n} 位沒到，換個字再找找',
  emptySearchHintDone: '這個名字不在名單上',
  someone: '有一位',
  draftRestored: '這是你上次還沒開成的名單。',
  draftDiscard: '清掉重來',
  dropClosed: '{name} 沒有存到：這個空間已經關閉了',
  dropNotOwner: '{name} 沒有存到：這台裝置沒有權限改這份名單',
  dropTooMany: '{name} 沒有加進去：名單人數已達上限',
  dropGone: '{name} 沒有存到：這個空間在伺服器上已經不在了',
  dropMore: '另有 {n} 筆',
  addWalkIn: '臨時加人',
  walkInPlaceholder: '沒報名但到場的人',
  /* 臨時加人預設已到：這個功能的定義就是「人已經站在你面前」。 */
  walkInIntoGroup: '會加進「{group}」，而且直接算已到。',
  walkInAdded: '{name} 已加入並標記已到',
  walkInAddedInGroup: '{name} 已加入「{group}」並標記已到',
  walkInAddedMany: '已加入 {n} 人並標記已到',
  backToTop: '回到名單頂端',
  calledAt: '已撥 {time}',
  callAgainMember: '再打給 {name}（{time} 撥過）',
  onlyMissing: '只看未到',
  showAll: '看全部',
  removeFromPreview: '把「{name}」從名單移除',
  signOutWhat: '登出後，這支手機自己開的空間照樣管得動；用帳號接過來的活動會暫時看不到，重新登入就會回來。',
  roomClosedShort: '已關閉',
  printTotal: '共 {people} 人（{heads} 人頭）',
  printBlanks: '日期：＿＿＿＿＿＿　　點名者：＿＿＿＿＿＿　　完成時間：＿＿＿＿＿＿',
  phoneTail: '尾碼 {tail}',
  copyFailed: '複製失敗，請長按選取文字',
  downloaded: '已下載 {name}',
  youAre: '你是 {name}',
  setYourName: '寫上你的名字 ›',
  /*
   * 這句話一度是假的：它說「複製空間」只有主揪做得到，但「再開一個」刻意對所有人
   * 開放（Sheets.tsx 的 owner 區塊從「編輯名單」才開始），同一個面板上方 3px 還對
   * 協助者寫著「你會是新空間的主揪」。開頭的「你是協助點名的人：」也在複述正上方
   * 那顆「協助點名」藥丸。留下的是協助者真正做不到、而且會需要去找主揪的那兩件事。
   */
  helperLimits: '編輯名單、結束這一輪只有主揪做得到。',
  remove: '移除',
  removeMember: '從名單移除',
  removeMemberSub: '這個動作不能復原',
  confirmRemoveMemberTitle: '把「{name}」從名單移除？',
  confirmRemoveMemberBody: '這個人會從所有裝置的名單上消失，而且不能復原。只是今天不來的話，用「標記請假」比較好——請假的人還留在名單上，只是不算進今天該到的人。',
  add: '加入名單',

  // 分享
  share: '分享',
  shareTitle: '讓其他人加入',
  shareHint: '把代碼或 QR 給他們，不用註冊、不用安裝。',
  whoIsHere: '現在在這個空間裡',
  onlyYouHere: '目前只有你。把代碼或 QR 給協助點名的人，他們進來後會出現在這裡。',
  peersHere: '{n} 支手機：{names}',
  peersAllAnon: '都還沒寫名字',
  peersPlusAnon: '，另外 {n} 支沒寫名字',
  shareLink: '傳給別人',
  shareLinkText: '一起點名',
  /* 單機模式下這三句取代整個分享面板：發出去的代碼對任何人都沒有用。 */
  shareLocalTitle: '這個空間只有你看得到',
  shareLocalBody: '這支手機沒連上雲端，名單只存在這裡。把代碼或連結給別人，他們會看到「找不到這個代碼」。',
  shareLocalHow: '多人一起點，要先設定雲端連線（見專案 README）。你還是可以自己點完，用「複製結果」或列印交出名單。',
  roomCode: '代碼',
  copyCode: '複製代碼',
  copyLink: '複製連結',
  copied: '已複製',
  scanToJoin: '掃描加入',

  // 管理
  manage: '管理',
  /*
   * 不叫「複製這個空間」。「複製」在這個 app 的其他五個地方都指複製到剪貼簿
   * （複製結果、複製代碼、複製連結、已複製、結果已複製），只有這裡指「開一個
   * 新的」——而且按下「複製這個空間」的當下，底部動作列的「複製結果」就在同一個
   * 畫面上。用「開」和首頁的「開啟空間」對齊：這個 app 裡「開」＝生出一個空間。
   * 英文不必跟著改：Copy／Duplicate 本來就是兩個詞，英文沒有這個碰撞。
   */
  copyRoom: '再開一個',
  copyRoomHint: '同一份名單、狀態全部歸零。回程點名用這個。',
  copyRoomHintHelper: '同一份名單、狀態全部歸零。你會是新空間的主揪。',
  copyRoomName: '新空間叫什麼？',
  returnTrip: '回程',
  editRoster: '編輯名單',
  editRosterWarning: '換掉名單會清除目前所有點名紀錄，確定嗎？',
  rename: '重新命名',
  closeRoom: '關閉空間',
  closeRoomHint: '關閉後就不能再點名，但紀錄還在。',
  /* 「車開了」那一刻的動作。名字用「結束這一輪」而不是「關閉空間」——
     使用者心裡想的是「這件事做完了」，不是「把一個容器關起來」。 */
  finishRound: '結束這一輪',
  finishRoundHint: '車開了就按這個。結束後不能再點名。',
  finishRoundBody: '紀錄還在。先帶走結果：',
  closedResult: '已結束 · {summary}',
  reopenRoom: '重新開啟',
  roomClosed: '這個空間已關閉',
  deleteRoom: '刪除空間',
  deleteRoomWarning: '刪除後無法復原，所有點名紀錄都會消失。確定嗎？',
  leaveRoom: '離開空間',
  expiresOn: '{date} 自動刪除',

  // 匯出
  /*
   * 這幾個 key 是「離開這個 App 之後別人讀到的字」：貼進 LINE 群的那段文字、
   * 下載下來的 CSV 表頭。它們一度直接寫死在 export.ts 裡，於是英文使用者按下
   * Copy result 交出去的是一整段中文——而收到的人沒有介面可以切語言。
   */
  shareArrived: '已到 {arrived} / {total} 人',
  shareMissingHeader: '未到 {n} 位：',
  shareMissingLine: '未到 {n} 位：{names}',
  shareGroupLine: '　{name}（{n}）：{names}',
  shareExcusedLine: '請假 {n} 位：{names}',
  /** 名字之間的分隔符。中文用頓號，英文用逗號加空格。 */
  listSeparator: '、',
  csvName: '姓名',
  csvStatus: '狀態',
  csvTime: '時間',
  csvBy: '點名者',
  csvPhone: '電話',
  csvCompanions: '攜伴',
  csvGroup: '分組',
  csvNote: '備註',
  export: '匯出',
  exportCsv: '下載 CSV',
  copySummary: '複製結果',
  summaryCopied: '結果已複製，可以直接貼到 LINE',

  // 同步
  syncOnline: '已同步',
  syncOffline: '離線中',
  syncPending: '{n} 筆待上傳',
  syncSyncing: '同步中…',
  syncLocalOnly: '單機模式',
  localOnlyHint: '這台裝置還沒設定雲端，名單只存在這支手機，其他人看不到。',

  // 錯誤
  errRoomNotFound: '找不到這個代碼。請確認有沒有打錯。',
  errConfusable: '代碼不會用到 {chars} 這些字元，請再確認一次。',
  errBadCode: '代碼是 6 碼英數字。',
  errNotOwner: '只有開啟這個空間的裝置可以做這件事。',
  errRoomClosed: '這個空間已經關閉了。',
  /*
   * 這句話只用在「動作真的失敗了」的地方——開空間、進空間、改名單、寄驗證碼。
   * 它一度寫成「你可以繼續點名，恢復連線後會自動上傳」，但那五個呼叫點沒有
   * 一個把東西排進待送佇列：空間沒開成、名單沒換成、驗證碼沒寄出。畫面上真正
   * 會自動上傳的只有點名，而那件事由同步指示（SyncBadge）負責說。
   */
  errOffline: '目前連不上網路，這個動作沒有完成。',
  errOfflineCreate: '目前連不上網路，空間沒有開成。你貼的名單還留著，連上網再按一次就好。',
  errJoinLocalOnly: '這個網站沒有連上雲端，空間只存在開啟它的那支手機裡，加不進來。',
  errJoinOffline: '目前連不上網路，還沒辦法把這個空間載下來。連上網再試一次。',
  errUnknown: '出了點問題，請再試一次。',
  errNotConfigured: '還沒設定雲端連線，目前是單機模式。',
  errGoogleFailed: 'Google 登入沒有完成。可以再試一次，或改用 Email 驗證碼。',
  errOauthLost: '登入的過程被中斷了（可能換了分頁或重開瀏覽器）。請再登入一次。',
  /* 「不安全」是瀏覽器的用詞，直接沿用——使用者網址列上看到的就是這三個字。 */
  errInsecureContext: 'Google 登入需要 HTTPS，而這個網址是不安全的 http://（例如區網 IP）。請改用下面的 Email 驗證碼，或改從 https:// 的網址開啟。',
  errTooMany: '這份名單的人數已達上限。',
  retry: '重試',

  settings: '設定',
  callMember: '打電話給 {name}',
  haptics: '震動回饋',
  hapticsHint: '點名時輕震一下，不用盯著畫面也知道點到了。部分裝置不支援。',
  on: '開',
  off: '關',
  overridden: '{name} 已由{who}改為{status}',
  overriddenAnon: '{name} 已被其他人改為{status}',
  overriddenMany: '有 {n} 筆點名被其他人改過',
  account: '主揪帳號',
  signIn: '登入',
  signOut: '登出',
  signedInAs: '已登入：{email}',
  signInGoogle: '用 Google 登入',
  signInWithEmail: '改用 Email 驗證碼',
  inAppBrowserWarn: '你現在是在 App 的內建瀏覽器裡（例如 LINE）。Google 在這裡常常會擋下登入——真的卡住的話，用右上角的選單「用瀏覽器開啟」，或改用下面的 Email 驗證碼。',
  insecureContextWarn: '這個網址是不安全的 http://，Google 登入在這裡不能用。請用下面的 Email 驗證碼，或改從 https:// 的網址開啟。',
  signInWhy: '登入後，換手機也管得動你開的空間，常用名單跟著走。協助點名的人不用登入。',
  emailLabel: 'Email',
  emailPlaceholder: 'you@example.com',
  sendCode: '寄驗證碼',
  codeSent: '驗證碼寄到 {email} 了，請查看信箱（也看一下垃圾郵件）。',
  codeLabel: '六碼驗證碼',
  verify: '登入',
  resend: '重寄',
  claimed: '已把這台裝置的 {rooms} 個空間、{rosters} 份常用名單接到你的帳號。',
  claimedNothing: '登入成功。',
  myRooms: '我的活動',
  myRoomsEmpty: '還沒有活動。開啟空間之後它就會出現在這裡，換手機也找得到。',
  roomStat: '{arrived} / {total} 人',
  errBadOtp: '驗證碼不對或已過期，請再試一次。',
  errRateLimited: '寄太多次了，請等幾分鐘再試。',
  group: '分組',
  /* 分段控制那一組原本的 aria-label 是 t('all')，於是螢幕閱讀器唸出「全部」群組、
     裡面第一顆也是「全部」。旁邊分組列用的是 t('group')，這裡照著補。 */
  filter: '篩選',
  allGroups: '全部',
  ungrouped: '未分組',
  changeGroup: '改分組',
  removeFromGroup: '移出分組',
  /* 晶片上印的是未到數，aria-label 卻唸「已到 0 / 4」——看到的和聽到的不是同一個
     數字。晶片的數字不加文字標籤（見 roll-call.md），文字說明就得說明那個數字。 */
  groupCount: '{name}：{n} 位沒到',
  boardMode: '看板模式',
  boardHint: '平板大字，放門邊給大家看。螢幕不自動關閉。',
  exitBoard: '離開看板',
  printRoster: '列印紙本名單',
  printHint: '印出空白名單備用，手機沒電時用筆勾。',

  // 通用
  cancel: '取消',
  confirm: '確定',
  save: '儲存',
  close: '關閉',
  back: '返回',
  language: '語言',
  theme: '主題',
  themeLight: '淺色',
  themeDark: '深色',
  themeSystem: '跟隨系統',
  yourName: '你的名字',
  /* 引號在這個 app 的用法是「照抄你會在畫面上看到的字」（shareLocalBody 引
     errRoomNotFound、confirmRemoveMemberBody 引 markExcused）。但「由你點的」
     全專案 grep 不到——名字下面真正出現的是 checkedBy「王小明 於 02:58」。
     英文版一直是對的（who checked each name），這裡把中文補上。 */
  yourNameHint: '選填。填了之後其他人會看到是你點的。',
  loading: '載入中…',
} as const

export type MessageKey = keyof typeof zh

const en: Record<MessageKey, string> = {
  appName: 'RollRoom',
  tagline: 'Everyone checks the same list',

  openRoom: 'Open a room',
  joinRoom: 'Join a room',
  roomNameLabel: "What's this event?",
  roomNamePlaceholder: 'e.g. Autumn trip · Departure',
  codePlaceholder: 'Enter the 6-character code',
  recentRooms: 'Recent rooms',
  noRecentRooms: 'No rooms yet. Open one, or join with a code.',
  owner: 'Mine',
  helper: 'Helping',
  create: 'Create',
  join: 'Join',
  forget: 'Remove from list',

  roster: 'Roster',
  pasteRoster: 'Paste the roster',
  pastePlaceholder: 'One name per line. Paste a chat thread as-is.',
  exampleFill: 'Fill in an example',
  exampleClear: 'Clear the example',
  exampleName: 'Autumn trip · Departure',
  exampleRoster: '1. Alice Chen 0912345678\n2. Bob Lin +1\n3) Dana Wu (absent)\n4. Ken Chang\n- Mia Wang\nSam Lee +2',
  fromNote: 'From the note',
  parsePreview: 'Preview',
  parsedCount: '{n} names',
  parsedHeads: '{n} heads incl. companions',
  duplicateWarning: 'Duplicate names: {names}. Checking one never moves the other; a note helps tell them apart.',
  skippedLines: '{n} lines skipped (not names)',
  emptyRoster: 'Paste a roster first',
  savedRosters: 'Saved rosters',
  saveAsRoster: 'Save as roster',
  saveRosterPrompt: 'Name this saved roster',
  useRoster: 'Use',
  deleteRoster: 'Delete',
  noSavedRosters: 'No saved rosters yet. Save one to reuse it next time.',

  missing: 'Missing',
  arrived: 'Here',
  excused: 'Excused',
  all: 'All',
  searchPlaceholder: 'Search names…',
  allHere: 'Everyone is here',
  missingCount: '{n} missing',
  missingUnit: 'still missing',
  headcount: '{arrived} / {total}',
  withCompanions: '+{n}',
  markArrived: 'Mark here',
  markMissing: 'Mark missing',
  markExcused: 'Mark excused',
  undo: 'Undo',
  undone: 'Undone',
  checkedBy: '{name} at {time}',
  at: '{time}',
  emptyList: 'Nobody here',
  emptyMissing: 'All accounted for',
  emptySearchHint: '{n} still missing — try a different spelling',
  emptySearchHintDone: 'That name is not on the list',
  someone: 'Someone',
  draftRestored: "This is the list you didn't finish last time.",
  draftDiscard: 'Start over',
  dropClosed: "{name} wasn't saved — this room is closed",
  dropNotOwner: "{name} wasn't saved — this device can't edit this list",
  dropTooMany: "{name} wasn't added — the list is full",
  dropGone: "{name} wasn't saved — this room no longer exists on the server",
  dropMore: '{n} more',
  addWalkIn: 'Add someone',
  walkInPlaceholder: 'Someone who showed up unregistered',
  walkInIntoGroup: 'Goes into \u201c{group}\u201d, marked as here.',
  walkInAdded: '{name} added and marked here',
  walkInAddedInGroup: '{name} added to \u201c{group}\u201d and marked here',
  walkInAddedMany: '{n} people added and marked here',
  backToTop: 'Back to top',
  calledAt: 'called {time}',
  callAgainMember: 'Call {name} again (tried {time})',
  onlyMissing: 'Only missing',
  showAll: 'Show all',
  removeFromPreview: 'Remove “{name}” from the list',
  signOutWhat: "After signing out you keep control of rooms this phone opened; events you took over with the account disappear until you sign in again.",
  roomClosedShort: 'Closed',
  printTotal: '{people} people ({heads} heads)',
  printBlanks: 'Date: ____________   Checked by: ____________   Finished: ____________',
  phoneTail: 'ends {tail}',
  copyFailed: "Couldn't copy — long-press to select the text",
  downloaded: 'Downloaded {name}',
  youAre: "You're {name}",
  setYourName: 'Add your name \u203a',
  helperLimits: "Editing the roster and finishing the round are the organiser's to do.",
  remove: 'Remove',
  removeMember: 'Remove from list',
  removeMemberSub: "This can't be undone",
  confirmRemoveMemberTitle: 'Remove \u201c{name}\u201d from the list?',
  confirmRemoveMemberBody: "They disappear from every device's list and this can't be undone. If they're just not coming today, use Mark excused instead \u2014 excused people stay on the list and simply don't count toward today's total.",
  add: 'Add',

  share: 'Share',
  shareTitle: 'Let others join',
  shareHint: 'Give them the code or the QR. No sign-up, no install.',
  whoIsHere: 'In this room now',
  onlyYouHere: "Just you so far. Give helpers the code or QR — they'll show up here once they join.",
  peersHere: '{n} phones: {names}',
  peersAllAnon: "nobody has set a name yet",
  peersPlusAnon: ', plus {n} without a name',
  shareLink: 'Send it',
  shareLinkText: 'Help me check names',
  shareLocalTitle: 'Only you can see this room',
  shareLocalBody: "This phone has no cloud set up, so the list lives only here. Anyone you give the code to will just see \u201cthat code doesn't match a room\u201d.",
  shareLocalHow: 'Sharing one list across phones needs a cloud connection (see the README). You can still finish here and hand the result over with Copy or print.',
  roomCode: 'Room code',
  copyCode: 'Copy code',
  copyLink: 'Copy link',
  copied: 'Copied',
  scanToJoin: 'Scan to join',

  manage: 'Manage',
  copyRoom: 'Duplicate room',
  copyRoomHint: 'Same roster, statuses reset. For the return trip.',
  copyRoomHintHelper: "Same roster, statuses reset. You'll own the new room.",
  copyRoomName: 'Name the new room',
  returnTrip: 'Return',
  editRoster: 'Edit roster',
  editRosterWarning: 'Replacing the roster clears every check-in. Continue?',
  rename: 'Rename',
  closeRoom: 'Close room',
  closeRoomHint: 'No more check-ins, but the record stays.',
  finishRound: 'Finish this round',
  finishRoundHint: 'Once the bus leaves. No more check-ins after.',
  finishRoundBody: 'The record stays. Take the result with you first:',
  closedResult: 'Finished · {summary}',
  reopenRoom: 'Reopen',
  roomClosed: 'This room is closed',
  deleteRoom: 'Delete room',
  deleteRoomWarning: 'This cannot be undone. Every check-in will be lost. Continue?',
  leaveRoom: 'Leave room',
  expiresOn: 'Auto-deleted on {date}',

  shareArrived: '{arrived} / {total} here',
  shareMissingHeader: '{n} missing:',
  shareMissingLine: '{n} missing: {names}',
  shareGroupLine: '  {name} ({n}): {names}',
  shareExcusedLine: '{n} excused: {names}',
  listSeparator: ', ',
  csvName: 'Name',
  csvStatus: 'Status',
  csvTime: 'Time',
  csvBy: 'Checked by',
  csvPhone: 'Phone',
  csvCompanions: 'Companions',
  csvGroup: 'Group',
  csvNote: 'Note',
  export: 'Export',
  exportCsv: 'Download CSV',
  copySummary: 'Copy result',
  summaryCopied: 'Result copied — paste it anywhere',

  syncOnline: 'Synced',
  syncOffline: 'Offline',
  syncPending: '{n} to upload',
  syncSyncing: 'Syncing…',
  syncLocalOnly: 'Local only',
  localOnlyHint: 'No cloud configured, so this list lives only on this device.',

  errRoomNotFound: "That code doesn't match a room. Check it again.",
  errConfusable: 'Room codes never use {chars}. Please check again.',
  errBadCode: 'A room code is 6 letters and digits.',
  errNotOwner: 'Only the device that opened this room can do that.',
  errRoomClosed: 'This room is closed.',
  errOffline: "You're offline — that didn't go through.",
  errOfflineCreate: "You're offline, so the room wasn't created. Your pasted list is still here — try again once you reconnect.",
  errJoinLocalOnly: 'This site has no cloud, so the room lives only on the phone that opened it.',
  errJoinOffline: "You're offline, so this room can't be loaded yet. Try again once you reconnect.",
  errUnknown: 'Something went wrong. Try again.',
  errNotConfigured: 'No cloud configured — running in local-only mode.',
  errGoogleFailed: "Google sign-in didn't complete. Try again, or use an email code instead.",
  errOauthLost: 'The sign-in was interrupted (a new tab, or the browser restarted). Please sign in again.',
  errInsecureContext: 'Google sign-in needs HTTPS, and this address is an insecure http:// one (a LAN IP, for example). Use the email code below, or open the app from an https:// address.',
  errTooMany: 'This list has reached its size limit.',
  retry: 'Retry',

  settings: 'Settings',
  callMember: 'Call {name}',
  haptics: 'Haptic feedback',
  hapticsHint: 'A short buzz on each check-in, so you need not watch the screen. Not supported on every device.',
  on: 'On',
  off: 'Off',
  overridden: '{name} was set to {status} by {who}',
  overriddenAnon: '{name} was set to {status} by someone else',
  overriddenMany: '{n} check-ins were changed by others',
  account: 'Organizer account',
  signIn: 'Sign in',
  signOut: 'Sign out',
  signedInAs: 'Signed in as {email}',
  signInGoogle: 'Sign in with Google',
  signInWithEmail: 'Use an email code instead',
  inAppBrowserWarn: "You're in an app's built-in browser (LINE, for example). Google often blocks sign-in here — if it does, use the menu to open this page in your real browser, or use the email code below.",
  insecureContextWarn: "This address is an insecure http:// one, so Google sign-in won't work here. Use the email code below, or open the app from an https:// address.",
  signInWhy: 'Sign in and your rooms and saved rosters follow you to a new phone. Helpers never need an account.',
  emailLabel: 'Email',
  emailPlaceholder: 'you@example.com',
  sendCode: 'Send code',
  codeSent: 'Code sent to {email}. Check your inbox (and spam).',
  codeLabel: 'Six-digit code',
  verify: 'Sign in',
  resend: 'Resend',
  claimed: 'Moved {rooms} rooms and {rosters} saved rosters to your account.',
  claimedNothing: 'Signed in.',
  myRooms: 'My events',
  myRoomsEmpty: 'No events yet. Open a room and it shows up here, on any device.',
  roomStat: '{arrived} / {total}',
  errBadOtp: 'That code is wrong or expired. Try again.',
  errRateLimited: 'Too many attempts. Wait a few minutes.',
  group: 'Group',
  filter: 'Filter',
  allGroups: 'All',
  ungrouped: 'No group',
  changeGroup: 'Change group',
  removeFromGroup: 'Remove from group',
  groupCount: '{name}: {n} missing',
  boardMode: 'Board mode',
  boardHint: 'For a tablet at the door. The screen stays awake.',
  exitBoard: 'Exit board',
  printRoster: 'Print paper roster',
  printHint: 'A blank tick-list, for when a phone dies.',

  cancel: 'Cancel',
  confirm: 'Confirm',
  save: 'Save',
  close: 'Close',
  back: 'Back',
  language: 'Language',
  theme: 'Theme',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeSystem: 'System',
  yourName: 'Your name',
  yourNameHint: 'Optional. Others will see who checked each name.',
  loading: 'Loading…',
}

export const messages = { zh, en } as const
export type Lang = keyof typeof messages

/** t('missingCount', { n: 3 }) → 「3 位沒到」 */
export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const raw: string = messages[lang][key] ?? messages.zh[key]
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => String(vars[name] ?? m))
}

/**
 * 這格裡的字，就是「填入範例」自己填進去的那一段嗎？
 *
 * 用來決定清除鍵要不要出現、以及它可以動哪一格。判準刻意嚴格到逐字相同：清除
 * 只該收回我們自己放進去的東西，使用者一動手改，那一格就不再屬於範例——否則那
 * 顆按鈕會從「取消範例」悄悄變成「清空我剛貼好的 200 人名單」，而兩者長得一模
 * 一樣。兩個欄位分開判，所以改了活動名稱不會連帶讓名單也失去清除鍵。
 *
 * 比對所有語言而不只是當下這個：填了中文範例再去設定裡切成英文，那段文字並不會
 * 跟著變，清除鍵沒有理由在這時候消失。
 */
function isExample(key: 'exampleName' | 'exampleRoster', text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return Object.values(messages).some((m) => m[key].trim() === trimmed)
}

export const isExampleName = (text: string): boolean => isExample('exampleName', text)
export const isExampleRoster = (text: string): boolean => isExample('exampleRoster', text)
