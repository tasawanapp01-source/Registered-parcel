import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Barcode,
  Camera,
  UserCheck,
  PackagePlus,
  Search,
  X,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Layers,
  RefreshCw,
  ImageUp,
  CheckCircle2,
  UserPlus,
  Building2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  Hash,
  Calendar,
  AlertTriangle,
  Package,
  Edit3,
  Dices,
  Sparkles,
  Database,
  Users,
  Download,
  FileSpreadsheet,
} from 'lucide-react';
import { useParcelSystem } from '../context/ParcelSystemContext';
import { BarcodeCameraScanner, decodeBarcodeFromImageFile } from './BarcodeCameraScanner';
import { DeliveryDateModal } from './DeliveryDateModal';
import { EditInboundParcelModal } from './EditInboundParcelModal';
import { DuplicateParcelModal } from './DuplicateParcelModal';
import {
  Parcel,
  ParcelCategory,
  ParcelStatus,
  PARCEL_CATEGORIES,
  COURIER_LIST,
  Student,
  getDormitoryTheme,
  getAvailableDormitories,
  detectCourierFromTracking,
  getCourierTrackingPrefix,
  generateUniqueParentTrackingNumber,
  generateUniqueSixDigitTracking,
  isUnknownOwnerParcel,
  formatStudentCode,
  getRelativeDateString,
  formatThaiSlashDate,
  extractParcelLocalYMD,
  isStudentOverConfiguredLimit,
  isRedHighlightTrackingNumber,
} from '../types/parcel';

const INBOUND_STATUS_OPTIONS: {
  value: ParcelStatus;
  label: string;
  desc: string;
  activeClass: string;
  inactiveClass: string;
  descActiveClass: string;
  descInactiveClass: string;
}[] = [
  {
    value: 'ลงทะเบียนรับพัสดุ',
    label: 'ลงทะเบียนรับพัสดุ',
    desc: 'พัสดุปกติ คัดแยกส่งหอพัก',
    activeClass: 'bg-emerald-600 text-white border-emerald-700 ring-2 ring-emerald-500/40 shadow-sm font-bold',
    inactiveClass: 'bg-slate-100/90 text-slate-400 border-slate-200/90 hover:bg-slate-200/60 hover:text-slate-600 hover:border-slate-300',
    descActiveClass: 'text-emerald-50 font-normal',
    descInactiveClass: 'text-slate-400',
  },
  {
    value: 'ติดต่องานพยาบาล',
    label: 'ติดต่องานพยาบาล',
    desc: 'ยารักษาโรค/เวชภัณฑ์',
    activeClass: 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold border-amber-600 ring-2 ring-amber-400/50 shadow-sm',
    inactiveClass: 'bg-slate-100/90 text-slate-400 border-slate-200/90 hover:bg-slate-200/60 hover:text-slate-600 hover:border-slate-300',
    descActiveClass: 'text-slate-950/90 font-medium',
    descInactiveClass: 'text-slate-400',
  },
  {
    value: 'ติดนิติการ',
    label: 'พัสดุติดนิติการ',
    desc: 'ต้องสงสัย/ผิดระเบียบ',
    activeClass: 'bg-red-600 text-white border-red-700 ring-2 ring-red-600/40 shadow-sm font-bold',
    inactiveClass: 'bg-slate-100/90 text-slate-400 border-slate-200/90 hover:bg-slate-200/60 hover:text-slate-600 hover:border-slate-300',
    descActiveClass: 'text-red-50 font-normal',
    descInactiveClass: 'text-slate-400',
  },
  {
    value: 'พัสดุไม่ทราบเจ้าของ',
    label: 'พัสดุไม่ทราบเจ้าของ',
    desc: 'ไม่ระบุชื่อชัดเจน',
    activeClass: 'bg-slate-800 text-white border-slate-900 ring-2 ring-slate-700/40 shadow-sm font-bold',
    inactiveClass: 'bg-slate-100/90 text-slate-400 border-slate-200/90 hover:bg-slate-200/60 hover:text-slate-600 hover:border-slate-300',
    descActiveClass: 'text-slate-100 font-normal',
    descInactiveClass: 'text-slate-400',
  },
];

const THAI_MONTH_NAMES_FULL = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

const THAI_DAY_HEADERS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

function formatThaiDisplayDate(isoDate?: string): string {
  if (!isoDate) return 'ทุกวัน (ยังไม่เลือกวันที่)';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const year = parseInt(parts[0], 10);
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const yearBE = year + 543;
  return `${day} ${THAI_MONTH_NAMES_FULL[monthIdx] || ''} ${yearBE}`;
}

function playScanBeep(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046.5, ctx.currentTime); // C6 beep
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // ignore audio context restrictions
  }
}

export interface InboundQuickAction {
  type: 'scan' | 'recent' | 'top';
  nonce: number;
}

interface InboundViewProps {
  quickAction?: InboundQuickAction | null;
}

export const InboundView: React.FC<InboundViewProps> = ({ quickAction }) => {
  const {
    students,
    parcels,
    lookupStudentByCode,
    lookupStudentWithCloudFallback,
    recordLocalSearchSaving,
    addInboundParcel,
    updateParcelStatus,
    upsertSingleStudent,
    refreshFromSupabase,
    getStudentParcelCounts,
    openWeeklyWarningPopup,
    parcelRateLimitConfig,
    user,
    currentMember,
    updateParcelDetails,
    supabaseParcelSummary,
    supabaseConnectionStatus,
    supabaseConnectionDetails,
    exportParcelsJson,
    exportParcelsCsv,
    isSyncing,
  } = useParcelSystem();

  // 1. ข้อมูลบาร์โค้ดและขนส่ง
  const [trackingNumber, setTrackingNumber] = useState<string>('');
  const [courier, setCourier] = useState<string>('Flash Express');
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);

  // โหมดการระบุเลขพัสดุ: 'six_digits' = กรอกเลขพัสดุ 6 ตัวสุดท้าย หรือ 'full' = ยิงบาร์โค้ดผ่านกล้อง/สแกนเนอร์/เลขเต็ม
  const [trackingInputMode, setTrackingInputMode] = useState<'six_digits' | 'full'>('six_digits');
  const [sixDigitsInput, setSixDigitsInput] = useState<string>('');
  const [includeCourierPrefix, setIncludeCourierPrefix] = useState<boolean>(true);

  // 2. ข้อมูลนักเรียน (กรอกและดึงข้อมูลนักเรียน - ค้นหาด้วยรหัสนักเรียน, ชื่อ, นามสกุล, ชื่อเล่น หรือหอพัก)
  const [studentCodeInput, setStudentCodeInput] = useState<string>('');
  const [studentSearchInput, setStudentSearchInput] = useState<string>('');
  const [studentPrefix, setStudentPrefix] = useState<string>('นาย');
  const [studentFullName, setStudentFullName] = useState<string>('');
  const [studentNickname, setStudentNickname] = useState<string>('');
  const [studentGradeRoom, setStudentGradeRoom] = useState<string>('');
  const [studentDormitory, setStudentDormitory] = useState<string>('');
  const [studentDormRoom, setStudentDormRoom] = useState<string>('');
  const [isManualEditStudentOpen, setIsManualEditStudentOpen] = useState<boolean>(false);
  const [isStudentSelected, setIsStudentSelected] = useState<boolean>(false);
  const [studentFetchFeedback, setStudentFetchFeedback] = useState<{
    type: 'success' | 'warning';
    message: string;
  } | null>(null);

  // 3. ประเภทสิ่งของ และรายละเอียดเพิ่มเติม (เครื่องสำอาง / อื่นๆ)
  // ตั้งค่าเริ่มต้นเป็น null สไตล์ disable ก่อนจนกว่าจะมีการเลือกหมวดหมู่สิ่งของ
  const [category, setCategory] = useState<ParcelCategory | null>(null);
  const [customCategoryDetail, setCustomCategoryDetail] = useState<string>('');

  // 4. สถานะการคัดแยกพัสดุ (ตั้งค่าเริ่มต้นเป็น null สีเทาสไตล์ disable เมื่อผู้ใช้คลิกเลือกจึงแสดงสีสรรของปุ่ม)
  const [status, setStatus] = useState<ParcelStatus | null>(null);
  const [note, setNote] = useState<string>('');
  // หมายเหตุสาเหตุพัสดุติดนิติการ: สั่งของเกินกำหนด, ของผิดระเบียบ, อื่นๆ (กรณีไม่ได้แจ้งสาเหตุสามารถเป็น null ได้)
  const [legalHoldReasonType, setLegalHoldReasonType] = useState<'สั่งของเกินกำหนด' | 'ของผิดระเบียบ' | 'อื่นๆ' | null>(null);
  const [customLegalNote, setCustomLegalNote] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  // 5. ตัวกรองเลือกแสดงตามวันที่รับเข้า หอพัก และตัวแบ่งหน้าสำหรับรายการพัสดุที่รับเข้าล่าสุด
  const [recentDateFilter, setRecentDateFilter] = useState<string>(() => getRelativeDateString(0));
  const [recentDormFilter, setRecentDormFilter] = useState<string>('ALL');
  const [recentPage, setRecentPage] = useState<number>(1);
  const [recentPageSize, setRecentPageSize] = useState<string>('10');

  // สถานะเปิด/ปิด และเดือน/ปี สำหรับปฏิทินภาษาไทย (พ.ศ.)
  const [isThaiCalendarOpen, setIsThaiCalendarOpen] = useState<boolean>(false);
  const thaiCalendarRef = useRef<HTMLDivElement | null>(null);

  const [calendarViewYear, setCalendarViewYear] = useState<number>(() => {
    const today = new Date();
    return today.getFullYear();
  });
  const [calendarViewMonth, setCalendarViewMonth] = useState<number>(() => {
    const today = new Date();
    return today.getMonth(); // 0-11
  });

  // ซิงก์เดือนและปีเมื่อมีการเปลี่ยน recentDateFilter
  useEffect(() => {
    if (recentDateFilter) {
      const parts = recentDateFilter.split('-');
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        if (!isNaN(y) && !isNaN(m)) {
          setCalendarViewYear(y);
          setCalendarViewMonth(m);
        }
      }
    }
  }, [recentDateFilter]);

  // ปิดปฏิทินภาษาไทยเมื่อคลิกนอกพื้นที่
  useEffect(() => {
    if (!isThaiCalendarOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (thaiCalendarRef.current && !thaiCalendarRef.current.contains(e.target as Node)) {
        setIsThaiCalendarOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isThaiCalendarOpen]);

  // ล้างข้อความแจ้งเตือนบันทึกสำเร็จอัตโนมัติ
  useEffect(() => {
    if (!saveSuccessMessage) return;
    const timer = setTimeout(() => {
      setSaveSuccessMessage(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [saveSuccessMessage]);

  // สถานะกล้องสแกนบาร์โค้ด
  const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);
  const [isScanningFile, setIsScanningFile] = useState<boolean>(false);

  // สถานะ Modal สำหรับเลือกวันที่รับพัสดุ (กรณีเซ็นรับสำเร็จจากรายการล่าสุด)
  const [deliveryModalParcel, setDeliveryModalParcel] = useState<Parcel | null>(null);
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState<boolean>(false);

  // สถานะ Modal สำหรับแก้ไขการรับพัสดุ (แก้ไขข้อมูลผู้รับพัสดุ, สถานะพัสดุ)
  const [editingParcel, setEditingParcel] = useState<Parcel | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);

  // สถานะ Modal สำหรับแจ้งเตือนเลขพัสดุซ้ำ "เลขพัสดุได้ถูกใช้งานแล้ว"
  const [duplicateParcel, setDuplicateParcel] = useState<Parcel | null>(null);
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState<boolean>(false);

  const step1SectionRef = useRef<HTMLElement | null>(null);
  const step2SectionRef = useRef<HTMLElement | null>(null);
  const step3SectionRef = useRef<HTMLElement | null>(null);
  const step4SectionRef = useRef<HTMLElement | null>(null);
  const dormGuideSectionRef = useRef<HTMLElement | null>(null);
  const recentParcelsSectionRef = useRef<HTMLElement | null>(null);
  const dismissedDuplicateTrackingRef = useRef<string>('');
  const [isSupabaseSummaryOpen, setIsSupabaseSummaryOpen] = useState<boolean>(false);
  const [isDormGuideOpen, setIsDormGuideOpen] = useState<boolean>(false);
  const [isRecentParcelsOpen, setIsRecentParcelsOpen] = useState<boolean>(false);
  // ขั้นตอนที่กำลังเปิดใช้งาน (1 = สแกนรหัสพัสดุ, 2 = กรอกข้อมูลนักเรียน และดึงข้อมูล, 3 = กรอกประเภทสิ่งของ, 4 = เลือกสถานะการคัดแยกพัสดุ, null = ย่อทุกขั้นตอน)
  const [activeInboundStep, setActiveInboundStep] = useState<1 | 2 | 3 | 4 | null>(1);
  const [activeSectionId, setActiveSectionId] = useState<
    'step1' | 'step2' | 'step3' | 'step4' | 'dorm' | 'recent'
  >('step1');
  const [isScrolledDown, setIsScrolledDown] = useState<boolean>(false);

  const handleOpenEditModal = (p: Parcel) => {
    setEditingParcel(p);
    setIsEditModalOpen(true);
  };

  const handleOpenDeliveryModal = (p: Parcel) => {
    setDeliveryModalParcel(p);
    setIsDeliveryModalOpen(true);
  };

  const handleConfirmDelivery = async (deliveredDate: string, deliveryNote?: string) => {
    if (!deliveryModalParcel) return;
    await updateParcelStatus(
      deliveryModalParcel.id,
      'ส่งมอบสำเร็จ',
      deliveryNote !== undefined ? deliveryNote : deliveryModalParcel.note,
      deliveredDate
    );
  };

  const trackingInputRef = useRef<HTMLInputElement | null>(null);
  const sixDigitsInputRef = useRef<HTMLInputElement | null>(null);
  const studentSearchInputRef = useRef<HTMLInputElement | null>(null);
  const studentCodeInputRef = useRef<HTMLInputElement | null>(null);
  const customCategoryInputRef = useRef<HTMLInputElement | null>(null);
  const barcodeFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastAutoPopulatedCodeRef = useRef<string>('');

  const availableDormitories = useMemo(
    () => getAvailableDormitories(students, parcels),
    [students, parcels]
  );

  // ค้นหาข้อมูลนักเรียนอัตโนมัติจาก Local Cache Map (0 Firestore Reads) เมื่อระบุรหัสนักเรียนชัดเจน
  const matchedStudent = useMemo(() => {
    const code = studentCodeInput.trim();
    if (!code) return null;
    return lookupStudentByCode(code) || lookupStudentByCode(formatStudentCode(code));
  }, [lookupStudentByCode, studentCodeInput]);

  // คำนวณจำนวนพัสดุของนักเรียนที่กำลังเลือกอยู่
  const activeStudentParcelStats = useMemo(() => {
    return getStudentParcelCounts(studentCodeInput, studentFullName, matchedStudent || undefined);
  }, [getStudentParcelCounts, studentCodeInput, studentFullName, matchedStudent]);

  // ปิดกล่องแจ้งเตือนสถานะการดึงข้อมูลนักเรียนอัตโนมัติเมื่อแสดงครบกำหนด
  useEffect(() => {
    if (!studentFetchFeedback) return;
    const timer = setTimeout(() => {
      setStudentFetchFeedback(null);
    }, 2800);
    return () => clearTimeout(timer);
  }, [studentFetchFeedback]);

  // ฟังก์ชันปรับสถานะการคัดแยกพัสดุในขั้นตอนที่ 4 อัตโนมัติ:
  // - หากสั่งพัสดุเกินเกณฑ์ที่กำหนดไว้ในระบบ -> กำหนดสถานะเป็น "พัสดุติดนิติการ" อัตโนมัติ
  // - หากไม่เกินเกณฑ์ -> กำหนดสถานะเป็น "ลงทะเบียนรับพัสดุ" อัตโนมัติ
  // - ส่วน "ติดต่องานพยาบาล" และ "พัสดุไม่ทราบเจ้าของ" ให้ผู้ใช้เลือกเอง (ไม่เขียนทับหากผู้ใช้เลือกไว้แล้ว)
  const applyAutoStatusForStudent = useCallback(
    (targetStudentCode: string, targetStudentName: string, targetStudent?: Student | null) => {
      const stats = getStudentParcelCounts(targetStudentCode, targetStudentName, targetStudent || undefined);
      const limitCheck = isStudentOverConfiguredLimit(stats, parcelRateLimitConfig, 1);
      const isOver = limitCheck.isOver || stats.isOverLimit;

      setStatus((prevStatus) => {
        // ส่วน "ติดต่องานพยาบาล" และ "พัสดุไม่ทราบเจ้าของ" ให้ผู้ใช้เลือกเอง (ไม่เปลี่ยนทับ)
        if (prevStatus === 'ติดต่องานพยาบาล' || prevStatus === 'พัสดุไม่ทราบเจ้าของ') {
          return prevStatus;
        }
        if (isOver) {
          setLegalHoldReasonType('สั่งของเกินกำหนด');
        }
        return isOver ? 'ติดนิติการ' : 'ลงทะเบียนรับพัสดุ';
      });

      return { isOver, stats, limitCheck };
    },
    [getStudentParcelCounts, parcelRateLimitConfig]
  );

  // ฟังก์ชันเติมข้อมูลนักเรียนลงในฟอร์มเมื่อดึงข้อมูลสำเร็จ พร้อมแจ้งเตือนและเลือกสถานะคัดแยกอัตโนมัติ
  const populateStudentFields = useCallback(
    (st: Student) => {
      setStudentCodeInput(st.studentCode);
      // ไม่เติมเลข 0 นำหน้า หรือแทนที่ข้อความที่ผู้ใช้พิมพ์ค้นหาในช่องค้นหา
      setStudentPrefix(st.prefix && st.prefix !== '-' ? st.prefix : 'นาย');
      const fullName = `${st.prefix && st.prefix !== '-' ? st.prefix : ''}${st.firstName} ${
        st.lastName && st.lastName !== '-' ? st.lastName : ''
      }`.trim();
      setStudentFullName(fullName);
      setStudentNickname(st.nickname && st.nickname !== '-' ? st.nickname : '');
      const gRoom =
        st.grade && st.grade !== '-'
          ? `${st.grade}${st.room && st.room !== '-' ? `/${st.room}` : ''}`
          : '';
      setStudentGradeRoom(gRoom);
      const dormName = st.dormitory && st.dormitory !== '-' ? st.dormitory : '';
      setStudentDormitory(dormName);
      setStudentDormRoom(st.dormRoom && st.dormRoom !== '-' ? st.dormRoom : '');

      const { isOver, stats: stStats, limitCheck } = applyAutoStatusForStudent(st.studentCode, fullName, st);

      setStudentFetchFeedback({
        type: isOver ? 'warning' : 'success',
        message: `ชื่อ: ${fullName} · หอพัก: ${dormName || '-'} · วันนี้: ${stStats.dayCount} ชิ้น · สัปดาห์นี้: ${stStats.weekCount} ชิ้น · เดือนนี้: ${stStats.monthCount} ชิ้น${
          isOver
            ? ' · ขั้นตอนที่ 4: เลือก "พัสดุติดนิติการ" อัตโนมัติ (สั่งพัสดุเกินเกณฑ์)'
            : ' · ขั้นตอนที่ 4: เลือก "ลงทะเบียนรับพัสดุ" อัตโนมัติ (อยู่ในเกณฑ์)'
        }`,
      });

      if (isOver) {
        openWeeklyWarningPopup(stStats, 'student_lookup', undefined, limitCheck.reasons);
      }
    },
    [applyAutoStatusForStudent, openWeeklyWarningPopup]
  );

  // เมื่อพิมพ์หรือสแกนรหัสนักเรียนตรงกับในระบบ ให้ดึงข้อมูลและแจ้งเตือนครั้งเดียวต่อการสแกน
  useEffect(() => {
    if (!matchedStudent) {
      lastAutoPopulatedCodeRef.current = '';
      return;
    }
    if (lastAutoPopulatedCodeRef.current === matchedStudent.studentCode) {
      return;
    }
    lastAutoPopulatedCodeRef.current = matchedStudent.studentCode;
    recordLocalSearchSaving();
    populateStudentFields(matchedStudent);
  }, [matchedStudent, recordLocalSearchSaving, populateStudentFields]);

  // ฟังก์ชันค้นหาและดึงข้อมูลนักเรียนด้วยรหัสนักเรียน, ชื่อ, นามสกุล, ชื่อเล่น หรือหอพัก (ค้นหาจากข้อมูลสำรองในระบบก่อน แล้วจึงค้นหาใน Firebase)
  const handleFetchStudentData = async () => {
    setFormError(null);
    const query = studentSearchInput.trim();

    if (!query) {
      setStudentFetchFeedback({
        type: 'warning',
        message: 'กรุณากรอกรหัสนักเรียน, ชื่อ, นามสกุล, ชื่อเล่น หรือหอพัก เพื่อดึงข้อมูล',
      });
      return;
    }

    const qLower = query.toLowerCase();
    const isNumericQuery = /^\d+$/.test(query);

    // ฟังก์ชันค้นหาแบบ LIKE ส่วนหนึ่งของรหัสนักเรียน, ชื่อ, นามสกุล, ชื่อเล่น, หอพัก
    const matchStudent = (s: Student) => {
      const cleanFullName = `${s.prefix || ''}${s.firstName || ''} ${s.lastName || ''}`.toLowerCase();
      const nameWithoutPrefix = `${s.firstName || ''} ${s.lastName || ''}`.toLowerCase();
      const rawCode = s.studentCode.toLowerCase().trim();
      const formattedCode = formatStudentCode(s.studentCode).toLowerCase().trim();
      const qNoZero = qLower.replace(/^0+/, '');
      const rawNoZero = rawCode.replace(/^0+/, '');

      return (
        rawCode.includes(qLower) ||
        formattedCode.includes(qLower) ||
        rawCode.endsWith(qLower) ||
        (isNumericQuery && qNoZero !== '' && rawNoZero.includes(qNoZero)) ||
        s.firstName.toLowerCase().includes(qLower) ||
        s.lastName.toLowerCase().includes(qLower) ||
        s.nickname.toLowerCase().includes(qLower) ||
        s.dormitory.toLowerCase().includes(qLower) ||
        cleanFullName.includes(qLower) ||
        nameWithoutPrefix.includes(qLower)
      );
    };

    if (isNumericQuery) {
      const paddedQuery = query.padStart(5, '0').toLowerCase();
      const qNoZero = qLower.replace(/^0+/, '');

      const exactCodeMatch = students.find((s) => {
        const rawCode = s.studentCode.toLowerCase().trim();
        const fsc = formatStudentCode(rawCode).toLowerCase().trim();
        const rawNoZero = rawCode.replace(/^0+/, '');
        return (
          rawCode === qLower ||
          rawCode === paddedQuery ||
          fsc === qLower ||
          fsc === paddedQuery ||
          (qNoZero !== '' && rawNoZero === qNoZero)
        );
      });

      const partialCodeMatch =
        exactCodeMatch ||
        students.find((s) => {
          const rawCode = s.studentCode.toLowerCase().trim();
          const fsc = formatStudentCode(rawCode).toLowerCase().trim();
          const rawNoZero = rawCode.replace(/^0+/, '');
          return (
            rawCode.includes(qLower) ||
            fsc.includes(qLower) ||
            rawCode.endsWith(qLower) ||
            (qNoZero !== '' && rawNoZero.includes(qNoZero))
          );
        }) ||
        students.find(matchStudent);

      if (partialCodeMatch) {
        lastAutoPopulatedCodeRef.current = partialCodeMatch.studentCode;
        recordLocalSearchSaving();
        populateStudentFields(partialCodeMatch);
        setIsStudentSelected(true);
        setActiveInboundStep(3);
        return;
      }

      // ไม่พบในหน่วยความจำ -> ค้นหาแบบเจาะจงจาก Supabase
      const cloudRes = await lookupStudentWithCloudFallback(query);
      if (cloudRes.student) {
        lastAutoPopulatedCodeRef.current = cloudRes.student.studentCode;
        populateStudentFields(cloudRes.student);
        setIsStudentSelected(true);
        setActiveInboundStep(3);
        return;
      }

      setStudentFetchFeedback({
        type: 'warning',
        message:
          students.length === 0
            ? 'ไม่พบในข้อมูลปัจจุบันและ Supabase คุณสามารถกด "แก้ไข / กรอกข้อมูลเอง" หรือนำเข้าข้อมูลนักเรียน'
            : `ไม่พบข้อมูลนักเรียนจากรหัส "${query}" ทั้งในระบบและ Supabase`,
      });
      return;
    }

    const exactMatch = students.find((s) => {
      const rawCode = s.studentCode.toLowerCase().trim();
      const formattedCode = formatStudentCode(s.studentCode).toLowerCase().trim();
      return (
        rawCode === qLower ||
        formattedCode === qLower ||
        s.firstName.toLowerCase() === qLower ||
        s.nickname.toLowerCase() === qLower
      );
    });

    const matched = exactMatch || students.find(matchStudent);

    if (matched) {
      lastAutoPopulatedCodeRef.current = matched.studentCode;
      recordLocalSearchSaving();
      populateStudentFields(matched);
      setIsStudentSelected(true);
      setActiveInboundStep(3);
      return;
    }

    setStudentFetchFeedback({
      type: 'warning',
      message:
        students.length === 0
          ? 'ยังไม่มีรายชื่อนักเรียนในระบบ คุณสามารถกด "แก้ไข / กรอกข้อมูลเอง" หรือนำเข้าข้อมูลนักเรียน'
          : `ไม่พบข้อมูลนักเรียนจากคำค้น "${query}" สามารถกด "แก้ไข / กรอกข้อมูลเอง" ด้านล่างได้`,
    });
  };

  // กรองรายชื่อนักเรียนจากข้อมูลจริงที่นำเข้าแล้ว (ค้นหาด้วย รหัสนักเรียน, ชื่อ, นามสกุล, ชื่อเล่น, หอพัก)
  const isStudentSearchActive = Boolean(studentSearchInput.trim());

  const filteredStudentSuggestions = useMemo(() => {
    const generalQ = studentSearchInput.trim().toLowerCase();

    if (!generalQ) return [];

    const isNumeric = /^\d+$/.test(generalQ);
    const qNoZero = generalQ.replace(/^0+/, '');
    const paddedQ = isNumeric ? generalQ.padStart(5, '0') : generalQ;

    const matchedList = students.filter((s) => {
      const cleanFullName = `${s.prefix || ''}${s.firstName || ''} ${s.lastName || ''}`.toLowerCase();
      const nameWithoutPrefix = `${s.firstName || ''} ${s.lastName || ''}`.toLowerCase();
      const formattedCode = formatStudentCode(s.studentCode).toLowerCase().trim();
      const rawCode = s.studentCode.toLowerCase().trim();
      const rawNoZero = rawCode.replace(/^0+/, '');

      return (
        rawCode.includes(generalQ) ||
        formattedCode.includes(generalQ) ||
        rawCode.endsWith(generalQ) ||
        (isNumeric && qNoZero !== '' && rawNoZero.includes(qNoZero)) ||
        s.firstName.toLowerCase().includes(generalQ) ||
        s.lastName.toLowerCase().includes(generalQ) ||
        s.nickname.toLowerCase().includes(generalQ) ||
        s.dormitory.toLowerCase().includes(generalQ) ||
        cleanFullName.includes(generalQ) ||
        nameWithoutPrefix.includes(generalQ)
      );
    });

    if (isNumeric) {
      matchedList.sort((a, b) => {
        const aRaw = a.studentCode.toLowerCase().trim();
        const aFmt = formatStudentCode(a.studentCode).toLowerCase().trim();
        const aNoZ = aRaw.replace(/^0+/, '');
        const bRaw = b.studentCode.toLowerCase().trim();
        const bFmt = formatStudentCode(b.studentCode).toLowerCase().trim();
        const bNoZ = bRaw.replace(/^0+/, '');

        const aExact = aRaw === generalQ || aFmt === paddedQ || (qNoZero !== '' && aNoZ === qNoZero) ? 1 : 0;
        const bExact = bRaw === generalQ || bFmt === paddedQ || (qNoZero !== '' && bNoZ === qNoZero) ? 1 : 0;
        return bExact - aExact;
      });
    }

    return matchedList.slice(0, 10);
  }, [students, studentSearchInput]);

  // สีประจำหอพัก (Color-Coding)
  const activeDormitoryName = studentDormitory.trim() || (matchedStudent ? matchedStudent.dormitory : '');
  const dormTheme = useMemo(() => getDormitoryTheme(activeDormitoryName), [activeDormitoryName]);

  const computeTrackingFromSixDigits = useCallback(
    (sixDigits: string, courierName: string, withPrefix: boolean): string => {
      const cleaned = sixDigits.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (!cleaned) return '';
      if (!withPrefix) return cleaned;
      const prefix = getCourierTrackingPrefix(courierName);
      return `${prefix}-${cleaned}`;
    },
    []
  );

  const handleTrackingChange = useCallback((val: string) => {
    setTrackingNumber(val);
    setFormError(null);
    dismissedDuplicateTrackingRef.current = '';
    if (val.trim().length >= 2) {
      setCourier(detectCourierFromTracking(val));
    }
  }, []);

  // สุ่มสร้างเลขพัสดุ 6 ตัวแบบสุ่ม ไม่ซ้ำในฐานข้อมูล เมื่อกดปุ่ม กรอก 6 ตัวท้าย
  const handleGenerateRandomSixDigits = useCallback(() => {
    setTrackingInputMode('six_digits');
    setFormError(null);
    dismissedDuplicateTrackingRef.current = '';

    const { sixDigits, fullTracking } = generateUniqueSixDigitTracking(
      parcels,
      courier,
      includeCourierPrefix
    );

    setSixDigitsInput(sixDigits);
    setTrackingNumber(fullTracking);
    setLastScannedCode(null);
    playScanBeep();

    setTimeout(() => {
      if (sixDigitsInputRef.current) {
        sixDigitsInputRef.current.focus();
        sixDigitsInputRef.current.select();
      }
    }, 80);
  }, [parcels, courier, includeCourierPrefix]);

  const handleSwitchTrackingMode = useCallback(
    (newMode: 'six_digits' | 'full') => {
      setTrackingInputMode(newMode);
      setFormError(null);
      dismissedDuplicateTrackingRef.current = '';
      if (newMode === 'six_digits') {
        // เมื่อกดปุ่ม กรอก 6 ตัวท้าย ให้ระบบสร้างเลขพัสดุ 6 ตัวแบบสุ่ม ไม่ซ้ำในฐานข้อมูล
        handleGenerateRandomSixDigits();
      } else {
        // เมื่อสลับข้อความเป็น "ยิงบาร์โค้ด / เลขเต็ม" ให้เคลียร์ ช่องรับเลขพัสดุให้ว่าง
        setTrackingNumber('');
        setSixDigitsInput('');
        setLastScannedCode(null);
        setTimeout(() => {
          if (trackingInputRef.current) {
            trackingInputRef.current.focus();
          }
        }, 80);
      }
    },
    [handleGenerateRandomSixDigits]
  );

  // ฟังก์ชันค้นหาพัสดุซ้ำในฐานข้อมูลอย่างละเอียด
  const findDuplicateParcel = useCallback(
    (candidate: string, sixDigits?: string): Parcel | null => {
      const cleaned = (candidate || '').trim().toUpperCase();
      if (!cleaned || courier === 'ผู้ปกครองฝากส่ง') return null;

      // 1. ตรวจสอบตรงตัว (Exact Match) กับ id หรือ trackingNumber
      const direct = parcels.find((p) => {
        const pId = (p.id || '').trim().toUpperCase();
        const pTn = (p.trackingNumber || '').trim().toUpperCase();
        return pId === cleaned || pTn === cleaned;
      });
      if (direct) return direct;

      // 2. ตรวจสอบเฉพาะตัวอักษรและตัวเลข (ตัดขีดช่องว่าง)
      const cleanedAlphaNum = cleaned.replace(/[^A-Z0-9]/g, '');
      if (cleanedAlphaNum.length >= 6) {
        const matchAlphaNum = parcels.find((p) => {
          const pIdAlphaNum = (p.id || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          const pTnAlphaNum = (p.trackingNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          return (
            pIdAlphaNum === cleanedAlphaNum ||
            pTnAlphaNum === cleanedAlphaNum ||
            pTnAlphaNum.endsWith(cleanedAlphaNum) ||
            pIdAlphaNum.endsWith(cleanedAlphaNum)
          );
        });
        if (matchAlphaNum) return matchAlphaNum;
      }

      // 3. ตรวจสอบกรณีเลข 6 ตัวท้าย
      const rawSix = (
        sixDigits ||
        (cleaned.length === 6 && /^[A-Z0-9]{6}$/.test(cleaned) ? cleaned : '')
      )
        .replace(/[^A-Z0-9]/g, '')
        .slice(-6);

      if (rawSix && rawSix.length === 6) {
        const prefix = getCourierTrackingPrefix(courier);
        const withPrefix = `${prefix}-${rawSix}`.toUpperCase();
        const sixMatch = parcels.find((p) => {
          const pId = (p.id || '').trim().toUpperCase();
          const pTn = (p.trackingNumber || '').trim().toUpperCase();
          const pTnAlphaNum = pTn.replace(/[^A-Z0-9]/g, '');
          const pIdAlphaNum = pId.replace(/[^A-Z0-9]/g, '');
          return (
            pTn === withPrefix ||
            pId === withPrefix ||
            pTn === rawSix ||
            pId === rawSix ||
            pTnAlphaNum.endsWith(rawSix) ||
            pIdAlphaNum.endsWith(rawSix)
          );
        });
        if (sixMatch) return sixMatch;
      }

      return null;
    },
    [parcels, courier]
  );

  // ตรวจสอบและแสดง popup ทันทีเมื่อพบเลขพัสดุซ้ำในฐานข้อมูล
  const checkAndNotifyDuplicate = useCallback(
    (trackingCandidate: string): Parcel | null => {
      const found = findDuplicateParcel(trackingCandidate, sixDigitsInput);
      if (found) {
        setDuplicateParcel(found);
        setIsDuplicateModalOpen(true);
        return found;
      }
      return null;
    },
    [findDuplicateParcel, sixDigitsInput]
  );

  const advanceFromStep1ToStep2 = useCallback(() => {
    setActiveInboundStep(2);
    setTimeout(() => {
      if (studentSearchInputRef.current) {
        studentSearchInputRef.current.focus();
      }
    }, 100);
  }, []);

  const handleSixDigitsChange = useCallback(
    (val: string) => {
      const cleaned = val.toUpperCase().replace(/[^A-Z0-9-]/g, '');
      dismissedDuplicateTrackingRef.current = '';

      // ถ้ายิงบาร์โค้ดผ่านเครื่องยิงหรือกรอกยาวเกิน 6 หลัก ให้สลับเป็นโหมดยิงบาร์โค้ด/เลขเต็มอัตโนมัติ
      if (cleaned.length > 6) {
        handleSwitchTrackingMode('full');
        handleTrackingChange(cleaned);
        playScanBeep();
        const dup = checkAndNotifyDuplicate(cleaned);
        if (!dup) {
          advanceFromStep1ToStep2();
        }
        return;
      }

      const filtered = cleaned.slice(0, 6);
      setSixDigitsInput(filtered);
      setFormError(null);
      const computed = computeTrackingFromSixDigits(filtered, courier, includeCourierPrefix);
      setTrackingNumber(computed);
      setLastScannedCode(null);

      if (filtered.length === 6) {
        playScanBeep();
        // หากเลขไม่ซ้ำ ให้ย่อกล่อง 1 แสดงเลขพัสดุ และเปิดกล่อง 2 กรอกข้อมูลนักเรียน
        const dup = findDuplicateParcel(computed, filtered);
        if (!dup) {
          advanceFromStep1ToStep2();
        }
      }
    },
    [
      courier,
      includeCourierPrefix,
      computeTrackingFromSixDigits,
      handleSwitchTrackingMode,
      handleTrackingChange,
      checkAndNotifyDuplicate,
      findDuplicateParcel,
      advanceFromStep1ToStep2,
    ]
  );

  const handleToggleCourierPrefix = useCallback(
    (checked: boolean) => {
      setIncludeCourierPrefix(checked);
      if (sixDigitsInput) {
        const computed = computeTrackingFromSixDigits(sixDigitsInput, courier, checked);
        setTrackingNumber(computed);
      }
    },
    [sixDigitsInput, courier, computeTrackingFromSixDigits]
  );

  const handleSelectCourier = useCallback(
    (selectedCourier: string) => {
      setCourier(selectedCourier);
      setFormError(null);
      dismissedDuplicateTrackingRef.current = '';

      if (selectedCourier === 'ผู้ปกครองฝากส่ง') {
        // เมื่อกดปุ่มผู้ปกครองส่ง ให้สร้างรหัสพัสดุ 13 ตัวไม่ซ้ำในฐานข้อมูลและลงท้ายด้วย RD แล้วเปิดกล่องข้อมูลนักเรียน
        const uniqueParentCode = generateUniqueParentTrackingNumber(parcels);
        setTrackingNumber(uniqueParentCode);
        setTrackingInputMode('full');
        setSixDigitsInput('');
        setLastScannedCode(null);
        playScanBeep();
        advanceFromStep1ToStep2();
        return;
      }

      // เมื่อกดปุ่มเลือกบริษัทขนส่ง ให้แสดงในรูปแบบกรอกเลขพัสดุ 6 ตัวสุดท้าย และสุ่มรหัสพัสดุใหม่ไม่ซ้ำในฐานข้อมูล
      setTrackingInputMode('six_digits');

      const { sixDigits, fullTracking } = generateUniqueSixDigitTracking(
        parcels,
        selectedCourier,
        includeCourierPrefix
      );

      setSixDigitsInput(sixDigits);
      setTrackingNumber(fullTracking);
      setLastScannedCode(null);
      playScanBeep();

      setTimeout(() => {
        if (sixDigitsInputRef.current) {
          sixDigitsInputRef.current.focus();
          sixDigitsInputRef.current.select();
        }
      }, 80);
    },
    [parcels, includeCourierPrefix, advanceFromStep1ToStep2]
  );

  // จัดการเมื่อสแกนบาร์โค้ดผ่านกล้องสำเร็จ
  const handleBarcodeDetected = useCallback(
    (decodedText: string) => {
      const cleaned = decodedText.trim();
      if (!cleaned) return;
      playScanBeep();
      // เมื่อยิงหรือสแกนบาร์โค้ดสำเร็จ เปลี่ยนเป็นโหมดเลขเต็มอัตโนมัติ
      setTrackingInputMode('full');
      handleTrackingChange(cleaned);
      setLastScannedCode(cleaned);
      setIsScannerOpen(false);

      // ตรวจสอบเลขพัสดุซ้ำ หากพบให้แสดง popup
      const dup = checkAndNotifyDuplicate(cleaned);
      if (dup) {
        return;
      }

      advanceFromStep1ToStep2();
    },
    [handleTrackingChange, checkAndNotifyDuplicate, advanceFromStep1ToStep2]
  );

  const requestCameraPermissionAndOpenScanner = useCallback(() => {
    setFormError(null);
    setTrackingInputMode('full');
    setIsScannerOpen(true);
  }, []);

  // เมื่อกดปุ่มสแกนโค้ด ให้แสดงในรูปแบบรับข้อมูลเลขพัสดุยิงบาร์โค้ดผ่านกล้อง
  const handleToggleScanner = useCallback(() => {
    setFormError(null);
    setTrackingInputMode('full');
    setIsScannerOpen(true);
    setTimeout(() => {
      if (trackingInputRef.current) {
        trackingInputRef.current.focus();
      }
    }, 100);
  }, []);

  // สแกนบาร์โค้ดจากไฟล์ภาพถ่ายกล้องหลังมือถือ (Fallback / Mobile Camera Capture)
  const handleScanBarcodeFromImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsScanningFile(true);
    setFormError(null);

    // เมื่อกดเลือกรูป/ถ่ายรูปบาร์โค้ด ให้สลับเป็นโหมดยิงบาร์โค้ด/เลขเต็มอัตโนมัติ
    if (trackingInputMode !== 'full') {
      handleSwitchTrackingMode('full');
    }

    try {
      const decodedText = await decodeBarcodeFromImageFile(file);
      handleBarcodeDetected(decodedText);
    } catch {
      setFormError(
        'ไม่พบบาร์โค้ดในภาพที่ถ่าย กรุณาถ่ายให้เห็นแถบบาร์โค้ดชัดเจน หรือพิมพ์เลขพัสดุในช่องกรอก'
      );
    } finally {
      setIsScanningFile(false);
      if (barcodeFileInputRef.current) {
        barcodeFileInputRef.current.value = '';
      }
    }
  };

  // บันทึกข้อมูลนักเรียนที่กรอกลงทะเบียนนักเรียนโดยตรง
  const handleSaveStudentOnly = async () => {
    const code = formatStudentCode(studentCodeInput.trim());
    const fullName = studentFullName.trim();
    if (!code || !fullName) {
      setFormError('กรุณากรอกรหัสนักเรียนและชื่อ-นามสกุลก่อนบันทึกลงทะเบียนนักเรียน');
      return;
    }
    setStudentCodeInput(code);

    const nameWithoutPrefix = fullName.replace(/^(นาย|นางสาว|ด\.ช\.|ด\.ญ\.|น\.ส\.)\s*/, '').trim();
    const nameParts = nameWithoutPrefix.split(/\s+/);
    const firstName = nameParts[0] || fullName;
    const lastName = nameParts.slice(1).join(' ') || '-';

    const gradeParts = (studentGradeRoom.trim() || '-/-').split('/');
    const grade = gradeParts[0] || '-';
    const room = gradeParts[1] || '-';

    await upsertSingleStudent({
      seqNo: matchedStudent ? matchedStudent.seqNo : students.length + 1,
      studentCode: code,
      prefix: studentPrefix || '-',
      firstName,
      lastName,
      nickname: studentNickname.trim() || '-',
      grade,
      room,
      dormitory: studentDormitory.trim() || '-',
      dormRoom: studentDormRoom.trim() || '-',
      bed: matchedStudent?.bed || '-',
    });

    setStudentFetchFeedback({
      type: 'success',
      message: `บันทึกข้อมูลนักเรียนรหัส ${code} (${fullName}) ลงในระบบเรียบร้อยแล้ว`,
    });
  };

  // ตรวจสอบความถูกต้องและครบถ้วนของข้อมูลในฟอร์มลงทะเบียนพัสดุทุกขั้นตอน
  const isTrackingValid = trackingNumber.trim().length > 0;

  // ตรวจหาพัสดุซ้ำในฐานข้อมูล
  const detectedDuplicateParcel = useMemo(() => {
    return findDuplicateParcel(trackingNumber, sixDigitsInput);
  }, [findDuplicateParcel, trackingNumber, sixDigitsInput]);

  const isDuplicateTracking = Boolean(detectedDuplicateParcel);

  // ตรวจหาพัสดุซ้ำในฐานข้อมูล เพื่อใช้สำหรับไม่อนุญาตให้บันทึก (disable ปุ่ม) และแจ้งเตือนในหน้าจอ
  // หมายเหตุ: popup แจ้งเตือนเลขพัสดุซ้ำจะแสดงเฉพาะตอนที่สแกนโค้ดเท่านั้น ไม่แสดงอัตโนมัติขณะกรอกหรือกดปุ่มบันทึก
  useEffect(() => {
    if (!detectedDuplicateParcel) {
      dismissedDuplicateTrackingRef.current = '';
    }
  }, [detectedDuplicateParcel]);

  const isStudentValid = useMemo(() => {
    // กรณีเลือกสถานะ 'พัสดุไม่ทราบเจ้าของ' ไม่จำเป็นต้องระบุข้อมูลนักเรียน
    if (status === 'พัสดุไม่ทราบเจ้าของ') return true;
    const hasName = Boolean(
      studentFullName.trim() ||
      (matchedStudent && `${matchedStudent.prefix || ''}${matchedStudent.firstName}`.trim())
    );
    const hasCode = Boolean(studentCodeInput.trim() || matchedStudent?.studentCode);
    const hasDorm = Boolean(
      studentDormitory.trim() ||
      (matchedStudent?.dormitory && matchedStudent.dormitory !== '-')
    );
    return hasName && hasCode && hasDorm;
  }, [status, studentFullName, studentCodeInput, studentDormitory, matchedStudent]);

  const isCategoryValid = useMemo(() => {
    if (!category) return false;
    if (category === 'อื่นๆ') {
      return customCategoryDetail.trim().length > 0;
    }
    return true;
  }, [category, customCategoryDetail]);

  const isStatusValid = useMemo(() => {
    if (status === null) return false;
    if (status === 'ติดนิติการ') {
      if (legalHoldReasonType === 'อื่นๆ') {
        return customLegalNote.trim().length > 0;
      }
      return true; // กรณีไม่ได้แจ้งสาเหตุ สามารถบันทึกได้โดยไม่ต้องระบุข้อความ
    }
    return true;
  }, [status, legalHoldReasonType, customLegalNote]);

  const isFormComplete =
    isTrackingValid && !isDuplicateTracking && isStudentValid && isCategoryValid && isStatusValid;

  const submitInboundParcel = async (overrideStatus?: ParcelStatus) => {
    setFormError(null);
    const effectiveStatus = overrideStatus ?? status;

    let finalTracking = trackingNumber.trim();

    if (courier === 'ผู้ปกครองฝากส่ง') {
      // กรณีเลือก ผู้ปกครองฝากส่ง ให้ใช้เลขพัสดุความยาว 13 ตัวอักษรลงท้ายด้วย RD เสมอ
      const isDuplicateInDb = parcels.some(
        (p) =>
          p.id.toUpperCase() === finalTracking.toUpperCase() ||
          p.trackingNumber.toUpperCase() === finalTracking.toUpperCase()
      );

      if (!finalTracking || finalTracking.length !== 13 || !finalTracking.endsWith('RD') || isDuplicateInDb) {
        finalTracking = generateUniqueParentTrackingNumber(parcels);
        setTrackingNumber(finalTracking);
      }
    } else if (trackingInputMode === 'six_digits') {
      if (!sixDigitsInput.trim()) {
        setFormError('กรุณากรอกเลขพัสดุ 6 ตัวสุดท้ายในขั้นตอนที่ 1');
        setActiveInboundStep(1);
        if (sixDigitsInputRef.current) sixDigitsInputRef.current.focus();
        return;
      }
      finalTracking = computeTrackingFromSixDigits(sixDigitsInput, courier, includeCourierPrefix);
      setTrackingNumber(finalTracking);

      // ตรวจสอบความซ้ำซ้อน: เมื่อกดปุ่มบันทึก ไม่แสดง popup แต่ไม่อนุญาตให้บันทึกลงทะเบียนพัสดุ
      const dup = findDuplicateParcel(finalTracking, sixDigitsInput);
      if (dup) {
        setFormError(`ไม่อนุญาตให้บันทึกลงทะเบียนพัสดุ เนื่องจากบาร์โค้ดหรือเลขพัสดุ "${finalTracking}" ได้ถูกใช้งานแล้วในระบบ`);
        setActiveInboundStep(1);
        return;
      }
    } else {
      if (!finalTracking) {
        setFormError('กรุณาสแกนรหัสพัสดุ หรือกรอกเลขพัสดุในขั้นตอนที่ 1');
        setActiveInboundStep(1);
        if (trackingInputRef.current) trackingInputRef.current.focus();
        return;
      }

      // ตรวจสอบความซ้ำซ้อน: เมื่อกดปุ่มบันทึก ไม่แสดง popup แต่ไม่อนุญาตให้บันทึกลงทะเบียนพัสดุ
      const dup = findDuplicateParcel(finalTracking, sixDigitsInput);
      if (dup) {
        setFormError(`ไม่อนุญาตให้บันทึกลงทะเบียนพัสดุ เนื่องจากบาร์โค้ดหรือเลขพัสดุ "${finalTracking}" ได้ถูกใช้งานแล้วในระบบ`);
        setActiveInboundStep(1);
        return;
      }
    }

    // ตรวจสอบความซ้ำซ้อนระดับฟอร์มอีกครั้งเพื่อป้องกันการบันทึกเมื่อเลขซ้ำ
    if (isDuplicateTracking) {
      setFormError('ไม่อนุญาตให้บันทึกลงทะเบียนพัสดุ เนื่องจากบาร์โค้ดหรือเลขพัสดุนี้ได้ถูกใช้งานแล้วในระบบ');
      setActiveInboundStep(1);
      return;
    }

    const finalStudentCode = formatStudentCode(
      studentCodeInput.trim() || (/^\d+$/.test(studentSearchInput.trim()) ? studentSearchInput.trim() : '')
    );
    const finalStudentName = studentFullName.trim();
    if (!finalStudentCode && !finalStudentName && effectiveStatus !== 'พัสดุไม่ทราบเจ้าของ') {
      setFormError('กรุณากรอกข้อมูลนักเรียน หรือค้นหาด้วยรหัสนักเรียน ชื่อ, นามสกุล, ชื่อเล่น หรือหอพักในขั้นตอนที่ 2 (หรือเลือกสถานะ "พัสดุไม่ทราบเจ้าของ")');
      setActiveInboundStep(2);
      if (studentSearchInputRef.current) studentSearchInputRef.current.focus();
      return;
    }

    if (!category) {
      setFormError('กรุณาเลือกประเภทสิ่งของในขั้นตอนที่ 3 ก่อนบันทึก');
      setActiveInboundStep(3);
      return;
    }

    // ตรวจสอบการกรอกประเภทสิ่งของ กรณีเลือก "อื่นๆ"
    const trimmedDetail = customCategoryDetail.trim();
    if (category === 'อื่นๆ' && !trimmedDetail) {
      setFormError('กรุณาระบุรายละเอียดประเภทสิ่งของในช่อง "อื่นๆ ให้กรอกว่าเป็นอะไร"');
      setActiveInboundStep(3);
      if (customCategoryInputRef.current) customCategoryInputRef.current.focus();
      return;
    }

    const formattedCategory: ParcelCategory = trimmedDetail
      ? `${category} (${trimmedDetail})`
      : category;

    if (!effectiveStatus) {
      setFormError('กรุณาเลือกสถานะการคัดแยกพัสดุในขั้นตอนที่ 4 (เช่น ลงทะเบียนรับพัสดุ, ติดต่องานพยาบาล, พัสดุติดนิติการ หรือพัสดุไม่ทราบเจ้าของ)');
      setActiveInboundStep(4);
      return;
    }

    let finalNote = note.trim();
    if (effectiveStatus === 'ติดนิติการ') {
      if (legalHoldReasonType === 'สั่งของเกินกำหนด') {
        finalNote = 'สั่งของเกินกำหนด';
      } else if (legalHoldReasonType === 'ของผิดระเบียบ') {
        finalNote = 'ของผิดระเบียบ';
      } else if (legalHoldReasonType === 'อื่นๆ') {
        const customReason = customLegalNote.trim();
        if (!customReason) {
          setFormError('กรุณาระบุรายละเอียดหมายเหตุสำหรับพัสดุติดนิติการ (เลือก "อื่นๆ")');
          return;
        }
        finalNote = customReason;
      } else {
        finalNote = ''; // กรณีไม่ได้แจ้งสาเหตุ
      }
    }

    const savedParcel = await addInboundParcel({
      trackingNumber: finalTracking,
      studentCode: finalStudentCode || 'UNKNOWN',
      category: formattedCategory,
      status: effectiveStatus,
      courier,
      note: finalNote,
      isSixDigitsInput: courier === 'ผู้ปกครองฝากส่ง' ? false : (trackingInputMode === 'six_digits'),
      customStudent: {
        studentFullName:
          finalStudentName ||
          (matchedStudent
            ? `${matchedStudent.prefix}${matchedStudent.firstName} ${matchedStudent.lastName}`
            : effectiveStatus === 'พัสดุไม่ทราบเจ้าของ'
            ? 'พัสดุไม่ทราบเจ้าของ'
            : '-'),
        nickname:
          studentNickname.trim() || (matchedStudent ? matchedStudent.nickname : '-'),
        gradeRoom:
          studentGradeRoom.trim() ||
          (matchedStudent ? `${matchedStudent.grade}/${matchedStudent.room}` : '-'),
        dormitory:
          studentDormitory.trim() ||
          (matchedStudent ? matchedStudent.dormitory : '-'),
        dormRoom:
          studentDormRoom.trim() || (matchedStudent ? matchedStudent.dormRoom : '-'),
        bed: matchedStudent ? matchedStudent.bed : '-',
      },
    });

    if (savedParcel.writeMode !== 'supabase_direct') {
      setSaveSuccessMessage(null);
      setFormError(
        `ไม่สามารถบันทึกพัสดุ "${savedParcel.trackingNumber}" ลงฐานข้อมูล Supabase ได้ (ไม่มีการบันทึกลง localStorage) กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตหรือโครงสร้างตาราง Supabase แล้วกดบันทึกใหม่อีกครั้ง`
      );
      return;
    }

    setSaveSuccessMessage(
      `บันทึกลงฐานข้อมูล Supabase โดยตรงสำเร็จ: ${savedParcel.trackingNumber} (${savedParcel.studentFullName || 'ไม่ทราบเจ้าของ'}) หอพัก: ${savedParcel.dormitory || '-'} · สถานะ: ${savedParcel.status}`
    );

    // เมื่อบันทึกแล้วให้ล้างฟอร์มทั้งหมด ย่อกล่อง 2-4 และกลับไปยังขั้นตอนที่ 1 เพื่อเตรียมพร้อมการสแกนพัสดุชิ้นต่อไป
    setTrackingNumber('');
    setSixDigitsInput('');
    setLastScannedCode(null);
    setCourier('Flash Express');
    setTrackingInputMode('six_digits');
    setCategory(null);
    setCustomCategoryDetail('');
    setNote('');
    setLegalHoldReasonType(null);
    setCustomLegalNote('');
    setStatus(null);

    // เคลียร์กล่องรับข้อมูล ค้นหาข้อมูลนักเรียน และข้อมูลผู้รับทั้งหมด
    setStudentCodeInput('');
    setStudentSearchInput('');
    setStudentFullName('');
    setStudentNickname('');
    setStudentGradeRoom('');
    setStudentDormitory('');
    setStudentDormRoom('');
    setIsManualEditStudentOpen(false);
    setIsStudentSelected(false);
    lastAutoPopulatedCodeRef.current = '';
    setStudentFetchFeedback(null);
    setFormError(null);

    // กลับไปยังเริ่มต้นเตรียมพร้อมการสแกนพัสดุชิ้นต่อไป (เปิดกล่อง 1 และย่อกล่องอื่นๆ)
    setActiveInboundStep(1);

    if (step1SectionRef.current) {
      step1SectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    setTimeout(() => {
      if (sixDigitsInputRef.current) {
        sixDigitsInputRef.current.focus();
        sixDigitsInputRef.current.select();
      } else if (trackingInputRef.current) {
        trackingInputRef.current.focus();
        trackingInputRef.current.select();
      }
    }, 150);
  };

  const handleSubmitInbound = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitInboundParcel();
  };

  const todayIsoStr = useMemo(() => getRelativeDateString(0), []);
  const yesterdayIsoStr = useMemo(() => getRelativeDateString(1), []);

  // คำนวณวันในเดือนสำหรับปฏิทินภาษาไทย (พ.ศ.)
  const thaiCalendarDays = useMemo(() => {
    const firstDayOfWeek = new Date(calendarViewYear, calendarViewMonth, 1).getDay(); // 0 (Sun) - 6 (Sat)
    const daysInMonth = new Date(calendarViewYear, calendarViewMonth + 1, 0).getDate();
    const prevMonthDaysCount = new Date(calendarViewYear, calendarViewMonth, 0).getDate();

    const days: {
      dateStr: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isToday: boolean;
      isSelected: boolean;
    }[] = [];

    // วันของเดือนก่อนหน้า (Padding)
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthDaysCount - i;
      const prevMonth = calendarViewMonth === 0 ? 11 : calendarViewMonth - 1;
      const prevYear = calendarViewMonth === 0 ? calendarViewYear - 1 : calendarViewYear;
      const dStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      days.push({
        dateStr: dStr,
        dayNumber: dayNum,
        isCurrentMonth: false,
        isToday: dStr === todayIsoStr,
        isSelected: dStr === recentDateFilter,
      });
    }

    // วันของเดือนปัจจุบัน
    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = `${calendarViewYear}-${String(calendarViewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({
        dateStr: dStr,
        dayNumber: d,
        isCurrentMonth: true,
        isToday: dStr === todayIsoStr,
        isSelected: dStr === recentDateFilter,
      });
    }

    // วันของเดือนถัดไป (Padding ให้ครบแถว)
    const remaining = (7 - (days.length % 7)) % 7;
    for (let nextD = 1; nextD <= remaining; nextD++) {
      const nextMonth = calendarViewMonth === 11 ? 0 : calendarViewMonth + 1;
      const nextYear = calendarViewMonth === 11 ? calendarViewYear + 1 : calendarViewYear;
      const dStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(nextD).padStart(2, '0')}`;
      days.push({
        dateStr: dStr,
        dayNumber: nextD,
        isCurrentMonth: false,
        isToday: dStr === todayIsoStr,
        isSelected: dStr === recentDateFilter,
      });
    }

    return days;
  }, [calendarViewYear, calendarViewMonth, todayIsoStr, recentDateFilter]);

  const handlePrevMonth = () => {
    if (calendarViewMonth === 0) {
      setCalendarViewMonth(11);
      setCalendarViewYear((prev) => prev - 1);
    } else {
      setCalendarViewMonth((prev) => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (calendarViewMonth === 11) {
      setCalendarViewMonth(0);
      setCalendarViewYear((prev) => prev + 1);
    } else {
      setCalendarViewMonth((prev) => prev + 1);
    }
  };

  const handleSelectDateFromCalendar = (dateStr: string) => {
    setRecentDateFilter(dateStr);
    setRecentPage(1);
    setIsThaiCalendarOpen(false);
  };

  // กรองพัสดุตามวันที่รับเข้าที่เลือก (ถ้าไม่ระบุหรือเว้นว่าง = แสดงทุกวัน)
  const parcelsForDate = useMemo(() => {
    if (!recentDateFilter) return parcels;
    return parcels.filter((p) => extractParcelLocalYMD(p) === recentDateFilter);
  }, [parcels, recentDateFilter]);

  // นับจำนวนพัสดุแยกตามหอพักสำหรับตัวกรอง "รายการพัสดุที่รับเข้าล่าสุด" (คำนวณตามวันที่เลือก)
  const dormParcelCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: parcelsForDate.length };
    for (const d of availableDormitories) {
      counts[d] = 0;
    }
    for (const p of parcelsForDate) {
      const dName = (p.dormitory || '').trim();
      if (dName) {
        counts[dName] = (counts[dName] || 0) + 1;
      }
    }
    return counts;
  }, [parcelsForDate, availableDormitories]);

  // กรองรายการพัสดุที่รับเข้าล่าสุดตามหอพักที่เลือก พร้อมแบ่งหน้า
  const allFilteredRecentParcels = useMemo(() => {
    return recentDormFilter === 'ALL'
      ? parcelsForDate
      : parcelsForDate.filter((p) => (p.dormitory || '').trim() === recentDormFilter);
  }, [parcelsForDate, recentDormFilter]);

  const effectivePageSize = useMemo(() => {
    if (recentPageSize === 'ALL') {
      return Math.max(1, allFilteredRecentParcels.length);
    }
    return Number(recentPageSize) || 10;
  }, [recentPageSize, allFilteredRecentParcels.length]);

  const totalRecentPages = useMemo(
    () => Math.max(1, Math.ceil(allFilteredRecentParcels.length / effectivePageSize)),
    [allFilteredRecentParcels.length, effectivePageSize]
  );

  const currentRecentPage = Math.min(recentPage, totalRecentPages);

  const filteredRecentParcels = useMemo(() => {
    if (recentPageSize === 'ALL') {
      return allFilteredRecentParcels;
    }
    const startIdx = (currentRecentPage - 1) * effectivePageSize;
    return allFilteredRecentParcels.slice(startIdx, startIdx + effectivePageSize);
  }, [allFilteredRecentParcels, currentRecentPage, effectivePageSize, recentPageSize]);

  // ติดตามตำแหน่งการเลื่อนหน้าจอเพื่อให้ไอคอนนำทางหัวข้อเน้นสถานะที่เหมาะสม
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolledDown(window.scrollY > 180);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const sectionEntries: Array<{
      id: 'step1' | 'step2' | 'step3' | 'step4' | 'dorm' | 'recent';
      el: HTMLElement | null;
    }> = [
      { id: 'step1', el: step1SectionRef.current },
      { id: 'step2', el: step2SectionRef.current },
      { id: 'step3', el: step3SectionRef.current },
      { id: 'step4', el: step4SectionRef.current },
      { id: 'dorm', el: dormGuideSectionRef.current },
      { id: 'recent', el: recentParcelsSectionRef.current },
    ];
    const validTargets = sectionEntries.filter(
      (s): s is { id: 'step1' | 'step2' | 'step3' | 'step4' | 'dorm' | 'recent'; el: HTMLElement } =>
        Boolean(s.el)
    );
    if (validTargets.length === 0) return;

    const visibilityMap = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const secId = entry.target.getAttribute('data-section-id');
          if (secId) {
            visibilityMap.set(secId, entry.isIntersecting);
          }
        }
        const firstVisible = validTargets.find((s) => visibilityMap.get(s.id));
        if (firstVisible) {
          setActiveSectionId(firstVisible.id);
        }
      },
      { threshold: 0.15, rootMargin: '-96px 0px -35% 0px' }
    );

    for (const s of validTargets) {
      observer.observe(s.el);
    }
    return () => observer.disconnect();
  }, [isDormGuideOpen, isRecentParcelsOpen]);

  const inboundSections = useMemo(
    () => [
      {
        id: 'step1' as const,
        title: '1. สแกน / กรอกเลขพัสดุ',
        ref: step1SectionRef,
      },
      {
        id: 'step2' as const,
        title: '2. ข้อมูลนักเรียนผู้รับ',
        ref: step2SectionRef,
      },
      {
        id: 'step3' as const,
        title: '3. ประเภทสิ่งของ',
        ref: step3SectionRef,
      },
      {
        id: 'step4' as const,
        title: '4. สถานะคัดแยก & บันทึก',
        ref: step4SectionRef,
      },
      {
        id: 'dorm' as const,
        title: 'ผังสีตะกร้าหอพัก',
        ref: dormGuideSectionRef,
      },
      {
        id: 'recent' as const,
        title: `รายการรับเข้าล่าสุด (${allFilteredRecentParcels.length})`,
        ref: recentParcelsSectionRef,
      },
    ],
    [allFilteredRecentParcels.length]
  );

  const scrollToSection = useCallback(
    (sectionId: 'step1' | 'step2' | 'step3' | 'step4' | 'dorm' | 'recent') => {
      if (sectionId === 'step1') setActiveInboundStep(1);
      if (sectionId === 'step2') setActiveInboundStep(2);
      if (sectionId === 'step3') setActiveInboundStep(3);
      if (sectionId === 'step4') setActiveInboundStep(4);
      if (sectionId === 'dorm') setIsDormGuideOpen(true);
      if (sectionId === 'recent') setIsRecentParcelsOpen(true);

      setTimeout(() => {
        const target = inboundSections.find((s) => s.id === sectionId);
        target?.ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActiveSectionId(sectionId);
      }, 40);
    },
    [inboundSections]
  );

  const handleStepSection = useCallback(
    (direction: 'prev' | 'next') => {
      const currentIndex = inboundSections.findIndex((s) => s.id === activeSectionId);
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      if (direction === 'prev' && baseIndex === 0) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const nextIndex =
        direction === 'prev'
          ? Math.max(0, baseIndex - 1)
          : Math.min(inboundSections.length - 1, baseIndex + 1);
      const target = inboundSections[nextIndex];
      if (target) {
        scrollToSection(target.id);
      }
    },
    [inboundSections, activeSectionId, scrollToSection]
  );

  const handleToggleRecentParcels = useCallback(() => {
    setIsRecentParcelsOpen((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => {
          recentParcelsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
      }
      return next;
    });
  }, []);

  const handleToggleDormGuide = useCallback(() => {
    setIsDormGuideOpen((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => {
          dormGuideSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
      }
      return next;
    });
  }, []);

  const handleScrollToScan = useCallback(() => {
    setActiveInboundStep(1);
    setTimeout(() => {
      step1SectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSectionId('step1');
      if (trackingInputMode === 'six_digits' && courier !== 'ผู้ปกครองฝากส่ง') {
        sixDigitsInputRef.current?.focus({ preventScroll: true });
        sixDigitsInputRef.current?.select();
      } else {
        trackingInputRef.current?.focus({ preventScroll: true });
        trackingInputRef.current?.select();
      }
    }, 120);
  }, [trackingInputMode, courier]);

  const lastHandledQuickActionRef = useRef<number>(0);

  useEffect(() => {
    if (!quickAction || quickAction.nonce === lastHandledQuickActionRef.current) return;
    lastHandledQuickActionRef.current = quickAction.nonce;

    if (quickAction.type === 'recent') {
      setIsRecentParcelsOpen(true);
      const timer = setTimeout(() => {
        recentParcelsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
      return () => clearTimeout(timer);
    }

    if (quickAction.type === 'top') {
      const timer = setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 40);
      return () => clearTimeout(timer);
    }

    if (quickAction.type === 'scan') {
      setFormError(null);
      setActiveInboundStep(1);
      setTrackingInputMode('full');
      setIsScannerOpen(true);
      const timer = setTimeout(() => {
        step1SectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [quickAction]);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Hidden container สำหรับสแกนบาร์โค้ดจากไฟล์รูปภาพ */}
      <div id="inbound-barcode-file-reader" className="hidden" />

      {/* ส่วนหัวหน้าจอรับเข้าพัสดุ + ปุ่มอยู่บรรทัดใหม่ (แสดงเฉพาะบนคอมพิวเตอร์) */}
      <div className="hidden lg:flex flex-col gap-3 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">
            ระบบลงทะเบียนรับเข้าและคัดแยกพัสดุประจำหอพัก (Inbound)
          </h1>
        </div>

        {/* ปุ่มสถานะ Supabase, ดูรายการพัสดุที่รับเข้าล่าสุด และ จุดคัดแยกลงตะกร้าหอพัก (ขึ้นบรรทัดใหม่) */}
        <div className="no-print flex flex-wrap items-center gap-2 pt-1">
          {/* ไอคอนเปิด/ปิดสถานะการบันทึกข้อมูล Supabase โดยตรง & ยอดรับเข้ารวมทุก User */}
          <button
            type="button"
            onClick={() => setIsSupabaseSummaryOpen((prev) => !prev)}
            aria-expanded={isSupabaseSummaryOpen}
            aria-label={
              isSupabaseSummaryOpen
                ? 'ซ่อนสถานะการบันทึกข้อมูล Supabase โดยตรง และยอดรับเข้ารวมทุก User'
                : 'ดูสถานะการบันทึกข้อมูล Supabase โดยตรง และยอดรับเข้ารวมทุก User'
            }
            title="คลิกเพื่อเปิด/ปิดสถานะการบันทึกข้อมูล Supabase โดยตรง & ยอดรับเข้ารวมทุก User"
            className={`min-h-[42px] px-3 py-2 border-2 rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center gap-2 cursor-pointer shrink-0 ${
              isSupabaseSummaryOpen
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 ring-2 ring-indigo-500/25'
                : 'bg-white hover:bg-indigo-50 text-slate-800 hover:text-indigo-900 border-slate-200 hover:border-indigo-300'
            }`}
          >
            <span className="relative flex items-center justify-center">
              <Database
                className={`w-4 h-4 shrink-0 ${
                  isSupabaseSummaryOpen ? 'text-white' : 'text-indigo-600'
                }`}
              />
              <span
                className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ring-2 ${
                  isSupabaseSummaryOpen ? 'ring-indigo-600' : 'ring-white'
                } ${
                  supabaseConnectionStatus === 'schema_missing'
                    ? 'bg-amber-400'
                    : supabaseConnectionStatus === 'disconnected'
                    ? 'bg-rose-500'
                    : 'bg-emerald-500'
                }`}
              />
            </span>
            <span>สถานะ Supabase</span>
            <span
              className={`px-1.5 py-0.5 rounded-md font-mono text-[11px] font-extrabold tabular-nums ${
                isSupabaseSummaryOpen
                  ? 'bg-white/20 text-white'
                  : 'bg-indigo-100 text-indigo-800'
              }`}
            >
              {supabaseParcelSummary.totalParcels.toLocaleString()}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${
                isSupabaseSummaryOpen ? 'rotate-180 text-white' : 'text-slate-500'
              }`}
            />
          </button>

          <button
            type="button"
            onClick={handleToggleRecentParcels}
            aria-expanded={isRecentParcelsOpen}
            title="คลิกเพื่อเปิด/ซ่อนรายการพัสดุที่รับเข้าล่าสุด"
            className={`min-h-[42px] px-4 py-2 border-2 rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center gap-2 cursor-pointer shrink-0 ${
              isRecentParcelsOpen
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 ring-2 ring-indigo-500/25'
                : 'bg-white hover:bg-indigo-50 text-slate-800 hover:text-indigo-900 border-slate-200 hover:border-indigo-300'
            }`}
          >
            <Layers className={`w-4 h-4 shrink-0 ${isRecentParcelsOpen ? 'text-white' : 'text-indigo-600'}`} />
            <span>ดูรายการพัสดุที่รับเข้าล่าสุด</span>
            <span
              className={`px-1.5 py-0.5 rounded-md font-mono text-[11px] font-extrabold tabular-nums ${
                isRecentParcelsOpen
                  ? 'bg-white/20 text-white'
                  : 'bg-indigo-100 text-indigo-800'
              }`}
            >
              {allFilteredRecentParcels.length}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${
                isRecentParcelsOpen ? 'rotate-180 text-white' : 'text-slate-500'
              }`}
            />
          </button>

          <button
            type="button"
            onClick={handleToggleDormGuide}
            aria-expanded={isDormGuideOpen}
            title="คลิกเพื่อเปิด/ซ่อนจุดคัดแยกลงตะกร้าหอพัก (Color-Coding Guide)"
            className={`min-h-[42px] px-4 py-2 border-2 rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center gap-2 cursor-pointer shrink-0 ${
              isDormGuideOpen
                ? 'bg-emerald-700 hover:bg-emerald-800 text-white border-emerald-700 ring-2 ring-emerald-500/25'
                : 'bg-white hover:bg-emerald-50 text-slate-800 hover:text-emerald-950 border-slate-200 hover:border-emerald-300'
            }`}
          >
            <span
              className="w-3 h-3 rounded-full shrink-0 border border-black/15"
              style={{ backgroundColor: dormTheme.hexColor }}
            />
            <span>จุดคัดแยกลงตะกร้าหอพัก (Color-Coding Guide)</span>
            <ChevronDown
              className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${
                isDormGuideOpen ? 'rotate-180 text-white' : 'text-slate-500'
              }`}
            />
          </button>
        </div>
      </div>

      {/* สรุปยอดรับเข้าพัสดุทั้งหมดรวมทุก User ในฐานข้อมูล Supabase (ซ่อนไว้และเปิดเมื่อคลิกไอคอน เฉพาะบนคอมพิวเตอร์) */}
      {isSupabaseSummaryOpen && (
      <section className="hidden lg:block no-print bg-white border border-indigo-200/90 rounded-2xl p-4 md:p-5 shadow-xs space-y-3.5 animate-in fade-in duration-150">
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Database className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-extrabold text-slate-900">
                  สถานะการบันทึกข้อมูล Supabase โดยตรง & ยอดรับเข้ารวมทุก User
                </h2>
                <span
                  className={`text-[10.5px] font-bold px-2 py-0.5 rounded-md border ${
                    supabaseConnectionStatus === 'schema_missing'
                      ? 'bg-amber-50 text-amber-900 border-amber-300'
                      : supabaseConnectionStatus === 'disconnected'
                      ? 'bg-rose-50 text-rose-800 border-rose-300'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  }`}
                >
                  {supabaseConnectionStatus === 'schema_missing'
                    ? 'ยังไม่ได้สร้างตารางใน Supabase'
                    : supabaseConnectionStatus === 'disconnected'
                    ? 'ไม่สามารถเชื่อมต่อ Supabase ได้'
                    : supabaseConnectionDetails?.connected
                    ? `Supabase ออนไลน์ · ${supabaseConnectionDetails.projectRef} (${supabaseConnectionDetails.latencyMs} ms)`
                    : 'Supabase ออนไลน์ · บันทึกตรงเข้าฐานข้อมูล'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                ข้อมูลพัสดุทั้งหมดอ่านและบันทึกลงฐานข้อมูล Supabase โดยตรงแบบเรียลไทม์ (ไม่บันทึกข้อมูลลง localStorage)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsSupabaseSummaryOpen(false)}
              aria-label="ซ่อนหน้าต่างสถานะ Supabase"
              title="ซ่อนหน้าต่างสถานะ Supabase"
              className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-slate-100">
            <button
              type="button"
              onClick={exportParcelsJson}
              className="min-h-[38px] px-3 py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>ส่งออก JSON</span>
            </button>
            <button
              type="button"
              onClick={exportParcelsCsv}
              className="min-h-[38px] px-3 py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>ส่งออก CSV</span>
            </button>
            <button
              type="button"
              onClick={() => void refreshFromSupabase()}
              disabled={isSyncing}
              className="min-h-[38px] px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>รีเฟรชข้อมูลจาก Supabase</span>
            </button>
          </div>
        </div>

        {/* ตัวเลขสรุปรวม */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
          <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3">
            <span className="text-[11px] text-indigo-800 font-semibold block">
              ยอดรับเข้าทั้งหมดใน Supabase (ทุก User)
            </span>
            <div className="text-xl font-mono font-black text-indigo-950 tabular-nums mt-0.5">
              {supabaseParcelSummary.totalParcels.toLocaleString()}{' '}
              <span className="text-xs font-semibold text-indigo-700">ชิ้น</span>
            </div>
          </div>

          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3">
            <span className="text-[11px] text-emerald-800 font-semibold block">
              รับเข้าวันนี้รวมทุก User
            </span>
            <div className="text-xl font-mono font-black text-emerald-900 tabular-nums mt-0.5">
              {supabaseParcelSummary.todayParcels.toLocaleString()}{' '}
              <span className="text-xs font-semibold text-emerald-700">ชิ้น</span>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <span className="text-[11px] text-slate-600 font-semibold block">
              จำนวนผู้บันทึกในระบบ
            </span>
            <div className="text-xl font-mono font-black text-slate-900 tabular-nums mt-0.5">
              {supabaseParcelSummary.byUser.length.toLocaleString()}{' '}
              <span className="text-xs font-semibold text-slate-600">User</span>
            </div>
          </div>
        </div>

        {/* รายละเอียดแยกตาม User */}
        {supabaseParcelSummary.byUser.length > 0 && (
          <div className="pt-2 border-t border-slate-100">
            <div className="text-[11px] font-bold text-slate-600 mb-2 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-indigo-600" />
              <span>ยอดรับเข้าใน Supabase แยกตามผู้ใช้งาน (User Breakdown):</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {supabaseParcelSummary.byUser.map((u) => (
                <div
                  key={u.userKey}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                >
                  <span className="font-bold text-slate-900">{u.userName}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 font-semibold">
                    {u.userRole}
                  </span>
                  <span className="font-mono font-bold text-indigo-700 tabular-nums">
                    รวม {u.totalParcels.toLocaleString()} ชิ้น
                  </span>
                  <span className="text-[11px] font-mono text-emerald-700 tabular-nums">
                    (วันนี้ {u.todayParcels.toLocaleString()})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      )}

      {saveSuccessMessage && (
        <div
          className={`p-4 border rounded-xl text-xs font-semibold flex items-center justify-between gap-3 shadow-xs ${
            saveSuccessMessage.includes('ไม่สำเร็จ') || saveSuccessMessage.includes('ไม่สามารถ')
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-emerald-50 border-emerald-300 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {saveSuccessMessage.includes('ไม่สำเร็จ') || saveSuccessMessage.includes('ไม่สามารถ') ? (
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            )}
            <span>{saveSuccessMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveSuccessMessage(null)}
            className="opacity-75 hover:opacity-100 p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {formError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-800 flex items-center justify-between gap-3">
          <span>{formError}</span>
          <button
            type="button"
            onClick={() => setFormError(null)}
            className="text-red-600 hover:text-red-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ฟอร์มลงทะเบียนรับเข้าพัสดุ: 1 แถว 1 กรอบข้อมูล */}
      <form onSubmit={handleSubmitInbound} className="space-y-6">
        {/* 1. สแกนรหัสพัสดุ */}
        <section
          ref={step1SectionRef}
          data-section-id="step1"
          className={`scroll-mt-28 bg-white border rounded-2xl transition-all ${
            activeInboundStep === 1
              ? 'border-slate-900/30 ring-2 ring-slate-900/10 p-5 md:p-6 space-y-4 shadow-xs'
              : 'border-slate-200 p-4 sm:px-5 sm:py-4 hover:border-slate-300'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => setActiveInboundStep((prev) => (prev === 1 ? null : 1))}
                className="text-base font-bold text-slate-900 flex items-center gap-2 cursor-pointer text-left"
              >
                <span
                  className={`w-6 h-6 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0 ${
                    isTrackingValid && !isDuplicateTracking
                      ? 'bg-emerald-600 text-white'
                      : activeInboundStep === 1
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {isTrackingValid && !isDuplicateTracking && activeInboundStep !== 1 ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    '1'
                  )}
                </span>
                <Barcode className="w-5 h-5 text-slate-700 shrink-0" />
                <span>สแกนรหัสพัสดุ</span>
              </button>

              {activeInboundStep !== 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  {trackingNumber.trim() ? (
                    <>
                      <span
                        className={`px-2.5 py-1 rounded-lg font-mono text-xs sm:text-sm font-extrabold border ${
                          isDuplicateTracking
                            ? 'bg-red-50 text-red-700 border-red-300'
                            : 'bg-emerald-50 text-emerald-900 border-emerald-200'
                        }`}
                      >
                        {trackingNumber}
                      </span>
                      <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                        {courier}
                      </span>
                      {isDuplicateTracking && (
                        <span className="text-[11px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-md">
                          เลขซ้ำ!
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-slate-400 font-medium">ยังไม่ได้สแกน/กรอกเลขพัสดุ</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {activeInboundStep === 1 ? (
                <>
                  <label className="min-h-[38px] px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer">
                    <ImageUp className="w-4 h-4 shrink-0" />
                    <span>{isScanningFile ? 'กำลังอ่าน...' : 'ถ่ายรูป/เลือกรูปบาร์โค้ด'}</span>
                    <input
                      ref={barcodeFileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleScanBarcodeFromImage}
                      className="sr-only"
                    />
                  </label>
                  {isTrackingValid && !isDuplicateTracking && (
                    <button
                      type="button"
                      onClick={advanceFromStep1ToStep2}
                      className="min-h-[38px] px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
                    >
                      <span>ถัดไป: ข้อมูลนักเรียน</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setActiveInboundStep(1);
                    setTimeout(() => {
                      if (trackingInputMode === 'six_digits' && courier !== 'ผู้ปกครองฝากส่ง') {
                        sixDigitsInputRef.current?.focus();
                        sixDigitsInputRef.current?.select();
                      } else {
                        trackingInputRef.current?.focus();
                      }
                    }, 80);
                  }}
                  className="min-h-[34px] px-3 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>{trackingNumber.trim() ? 'แก้ไข / สแกนใหม่' : 'เปิดสแกน'}</span>
                </button>
              )}
            </div>
          </div>

          {activeInboundStep === 1 && (
            <div className="space-y-4 pt-1">
              {/* หน้าจอกล้องสแกนบาร์โค้ดสด (บังคับกล้องหลังมือถือเป็นหลัก + สลับเลนส์ได้) */}
              <BarcodeCameraScanner
                isOpen={isScannerOpen}
                onClose={() => setIsScannerOpen(false)}
                onDetected={handleBarcodeDetected}
                onScanFromFile={handleScanBarcodeFromImage}
                isScanningFile={isScanningFile}
              />

              {lastScannedCode && (
                <div className="px-3.5 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-900">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      สแกนบาร์โค้ดสำเร็จ: <strong className="font-mono">{lastScannedCode}</strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={requestCameraPermissionAndOpenScanner}
                    className="text-emerald-700 font-bold hover:underline cursor-pointer"
                  >
                    สแกนซ้ำ
                  </button>
                </div>
              )}

              {/* ส่วนกรอกข้อมูล: สลับระหว่าง "กรอกเลขพัสดุ 6 ตัวสุดท้าย" กับ "ยิงบาร์โค้ด / เลขเต็ม" (กรณีผู้ปกครองฝากส่งจะใช้เลขพัสดุแบบเต็มเสมอ) */}
              {trackingInputMode === 'six_digits' && courier !== 'ผู้ปกครองฝากส่ง' ? (
                <div className="space-y-3 bg-amber-50/70 border-2 border-amber-300 rounded-2xl p-4 sm:p-5 animate-in fade-in duration-150">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-200/80 pb-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-amber-600 text-white flex items-center justify-center font-bold text-xs">
                        #6
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-amber-950">
                          กรอกเลขพัสดุ 6 ตัวสุดท้าย
                        </h3>
                        <p className="text-[11px] text-amber-800">
                          ดูตัวเลข 6 ตัวท้ายจากฉลากกล่องพัสดุ แล้วพิมพ์ลงในช่องนี้
                        </p>
                      </div>
                    </div>

                    {/* ตัวเลือกรหัสขนส่งนำหน้า */}
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-amber-950 cursor-pointer select-none bg-white/80 px-2.5 py-1.5 rounded-lg border border-amber-200 hover:bg-white transition-colors">
                      <input
                        type="checkbox"
                        checked={includeCourierPrefix}
                        onChange={(e) => handleToggleCourierPrefix(e.target.checked)}
                        className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-amber-300 cursor-pointer"
                      />
                      <span>ใส่รหัสขนส่งนำหน้า ({getCourierTrackingPrefix(courier)}-)</span>
                    </label>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <div className="flex items-center gap-2 flex-1">
                      {/* แสดงรหัสคำนำหน้าขนส่ง เช่น TH-, KER-, ED- */}
                      {includeCourierPrefix && (
                        <div className="min-h-[52px] px-3.5 sm:px-4 bg-amber-100 border-2 border-amber-300 text-amber-950 rounded-xl font-mono font-black text-lg flex items-center justify-center shrink-0 shadow-2xs select-none">
                          {getCourierTrackingPrefix(courier)}-
                        </div>
                      )}

                      {/* ช่องกรอกเลข 6 ตัวท้ายขนาดใหญ่ ตัวพิมพ์ใหญ่อัตโนมัติ Monospace */}
                      <div className="relative flex-1">
                        <input
                          ref={sixDigitsInputRef}
                          id="six-digits-input"
                          type="text"
                          value={sixDigitsInput}
                          onChange={(e) => handleSixDigitsChange(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (sixDigitsInput.trim()) {
                                playScanBeep();
                                const dup = checkAndNotifyDuplicate(trackingNumber);
                                if (!dup) {
                                  advanceFromStep1ToStep2();
                                }
                              }
                            }
                          }}
                          onPaste={(e) => {
                            const pasted = e.clipboardData.getData('text').trim();
                            if (pasted.length > 6) {
                              e.preventDefault();
                              handleSwitchTrackingMode('full');
                              handleTrackingChange(pasted);
                              playScanBeep();
                              const dup = checkAndNotifyDuplicate(pasted);
                              if (!dup) {
                                advanceFromStep1ToStep2();
                              }
                            }
                          }}
                          placeholder="เช่น 123456"
                          className="w-full min-h-[52px] px-4 pr-20 py-3 text-lg font-mono font-black tracking-widest text-slate-900 bg-white border-2 border-amber-400 rounded-xl focus:border-amber-600 focus:ring-2 focus:ring-amber-400/40 focus:outline-none uppercase placeholder:text-slate-400 placeholder:font-normal placeholder:tracking-normal transition-all"
                        />
                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                          <button
                            type="button"
                            aria-label="สุ่มเลข 6 ตัวใหม่"
                            title="กดเพื่อสุ่มเลข 6 ตัวใหม่ (ไม่ซ้ำในฐานข้อมูล)"
                            onClick={handleGenerateRandomSixDigits}
                            className="min-h-[32px] min-w-[32px] flex items-center justify-center text-amber-600 hover:text-amber-800 hover:bg-amber-100 rounded-lg cursor-pointer transition-colors"
                          >
                            <Dices className="w-4 h-4" />
                          </button>
                          {sixDigitsInput && (
                            <button
                              type="button"
                              aria-label="ล้างเลข 6 ตัวท้าย"
                              onClick={() => handleSixDigitsChange('')}
                              className="min-h-[32px] min-w-[32px] flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ปุ่มสลับโหมดและปุ่มสแกนโค้ด (ปุ่มสลับอยู่หน้าปุ่มสแกนโค้ดเท่านั้น) */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSwitchTrackingMode('full')}
                        title="สลับไปสแกนบาร์โค้ด หรือกรอกเลขเต็ม"
                        className="min-h-[52px] px-3.5 sm:px-4 py-3 bg-white hover:bg-slate-100 text-slate-800 border-2 border-amber-300 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                      >
                        <Barcode className="w-4 h-4 shrink-0 text-slate-700" />
                        <span>เลขเต็ม / สแกน</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleToggleScanner}
                        title="กดปุ่มสแกนโค้ดเพื่อเปิดกล้อง (จะเปลี่ยนเป็นโหมดเลขเต็มอัตโนมัติ)"
                        className="min-h-[52px] px-5 py-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl flex items-center gap-2 cursor-pointer transition-colors shadow-2xs"
                      >
                        <Camera className="w-4 h-4 shrink-0" />
                        <span>สแกนโค้ด</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        ref={trackingInputRef}
                        id="tracking-number-input"
                        type="text"
                        value={trackingNumber}
                        onChange={(e) => handleTrackingChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = trackingNumber.trim();
                            if (val) {
                              playScanBeep();
                              // สแกนโค้ดผ่านเครื่องยิง: หากเลขพัสดุซ้ำ ให้แสดง popup
                              const dup = findDuplicateParcel(val);
                              if (dup) {
                                setDuplicateParcel(dup);
                                setIsDuplicateModalOpen(true);
                                return;
                              }
                              advanceFromStep1ToStep2();
                            }
                          }
                        }}
                        placeholder={
                          courier === 'ผู้ปกครองฝากส่ง'
                            ? 'เลขพัสดุผู้ปกครองฝากส่ง...'
                            : 'สแกนบาร์โค้ดผ่านกล้อง / เครื่องสแกน หรือพิมพ์เลขพัสดุ...'
                        }
                        className={`w-full min-h-[52px] px-4 pr-10 py-3 text-base font-mono font-semibold rounded-xl border-2 focus:outline-none transition-colors ${
                          courier === 'ผู้ปกครองฝากส่ง'
                            ? 'text-indigo-950 bg-indigo-50/70 border-indigo-400 focus:bg-white focus:border-indigo-600'
                            : 'text-slate-900 bg-slate-50 border-slate-300 focus:bg-white focus:border-slate-900'
                        }`}
                      />
                      {trackingNumber && (
                        <button
                          type="button"
                          aria-label="ล้างเลขพัสดุ"
                          onClick={() => {
                            if (courier === 'ผู้ปกครองฝากส่ง') {
                              const newAuto = generateUniqueParentTrackingNumber(parcels);
                              setTrackingNumber(newAuto);
                            } else {
                              setTrackingNumber('');
                              setLastScannedCode(null);
                            }
                          }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* ปุ่มสลับโหมดและปุ่มสแกนโค้ด (ปุ่มสลับอยู่หน้าปุ่มสแกนโค้ดเท่านั้น) */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSwitchTrackingMode('six_digits')}
                        title="สลับไปกรอกเลขพัสดุ 6 ตัวท้าย"
                        className="min-h-[52px] px-3.5 sm:px-4 py-3 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                      >
                        <Hash className="w-4 h-4 shrink-0" />
                        <span>กรอก 6 ตัวท้าย</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleToggleScanner}
                        title="เปิดกล้องเพื่อสแกนบาร์โค้ด"
                        className="min-h-[52px] px-5 py-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl flex items-center gap-2 cursor-pointer transition-colors shadow-2xs"
                      >
                        <Camera className="w-4 h-4 shrink-0" />
                        <span>สแกนโค้ด</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* แสดงการแจ้งเตือนเมื่อเลขพัสดุซ้ำในฐานข้อมูล พร้อมปุ่มเปิดดูข้อมูล */}
              {isDuplicateTracking && (
                <div className="px-3.5 py-2.5 bg-red-50 border-2 border-red-300 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs text-red-900 animate-in fade-in duration-150 shadow-xs">
                  <div className="flex items-center gap-2 font-bold">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 animate-pulse" />
                    <span>เลขพัสดุนี้ได้ถูกใช้งานแล้วในระบบ</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => checkAndNotifyDuplicate(trackingNumber)}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg cursor-pointer transition-colors shadow-2xs"
                  >
                    ดูข้อมูลพัสดุที่ซ้ำ
                  </button>
                </div>
              )}

              {/* ปุ่มเลือกบริษัทขนส่ง */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="block text-xs font-medium text-slate-500">
                    บริษัทขนส่ง (เลือกบริษัทขนส่งได้ หรือตรวจจับอัตโนมัติจากเลขพัสดุ):
                  </span>
                  <span className="text-xs font-semibold text-slate-700">
                    ขนส่งปัจจุบัน: <strong className="text-slate-900">{courier}</strong>
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {COURIER_LIST.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => handleSelectCourier(c)}
                      className={`min-h-[40px] px-3.5 py-2 text-xs font-semibold rounded-xl border transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                        courier === c
                          ? c === 'ผู้ปกครองฝากส่ง'
                            ? 'bg-indigo-700 text-white border-indigo-700 shadow-sm font-bold ring-2 ring-indigo-500/30'
                            : 'bg-slate-900 text-white border-slate-900 shadow-sm'
                          : c === 'ผู้ปกครองฝากส่ง'
                          ? 'bg-indigo-50/70 text-indigo-900 border-indigo-200 hover:bg-indigo-100 font-medium'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span>{c}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

          {/* 2. กรอกข้อมูลนักเรียน และดึงข้อมูล */}
          <section
            ref={step2SectionRef}
            data-section-id="step2"
            className={`scroll-mt-28 bg-white border rounded-2xl transition-all ${
              activeInboundStep === 2
                ? 'border-slate-900/30 ring-2 ring-slate-900/10 p-5 md:p-6 space-y-4 shadow-xs'
                : 'border-slate-200 p-4 sm:px-5 sm:py-4 hover:border-slate-300'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setActiveInboundStep((prev) => (prev === 2 ? null : 2))}
                  className="text-base font-bold text-slate-900 flex items-center gap-2 cursor-pointer text-left"
                >
                  <span
                    className={`w-6 h-6 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0 ${
                      isStudentValid && (studentFullName.trim() || matchedStudent)
                        ? 'bg-emerald-600 text-white'
                        : activeInboundStep === 2
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {isStudentValid && (studentFullName.trim() || matchedStudent) && activeInboundStep !== 2 ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      '2'
                    )}
                  </span>
                  <UserCheck className="w-5 h-5 text-slate-700 shrink-0" />
                  <span>กรอกข้อมูลนักเรียน และดึงข้อมูล</span>
                </button>

                {activeInboundStep !== 2 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {studentFullName.trim() || matchedStudent ? (
                      <>
                        <span className="text-sm font-bold text-slate-900">
                          {studentFullName.trim() ||
                            `${matchedStudent?.prefix || ''}${matchedStudent?.firstName || ''} ${
                              matchedStudent?.lastName || ''
                            }`}
                        </span>
                        {activeDormitoryName && (
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-extrabold border shadow-2xs ${dormTheme.bgClass} ${dormTheme.borderClass}`}
                            style={{ borderColor: dormTheme.hexColor, color: dormTheme.hexColor }}
                          >
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: dormTheme.hexColor }}
                            />
                            <span>{activeDormitoryName}</span>
                            {(studentDormRoom.trim() || matchedStudent?.dormRoom) && (
                              <span className="font-mono text-[11px]">
                                ห้อง {studentDormRoom.trim() || matchedStudent?.dormRoom}
                              </span>
                            )}
                          </span>
                        )}
                        {activeStudentParcelStats.isOverLimit && (
                          <span className="px-2 py-0.5 rounded-md bg-red-100 text-red-800 border border-red-300 text-[11px] font-bold">
                            เกินเกณฑ์
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-slate-400 font-medium">ยังไม่ได้เลือกข้อมูลนักเรียน</span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {activeInboundStep === 2 ? (
                  <>
                    {user && (
                      <button
                        type="button"
                        onClick={() => void refreshFromSupabase()}
                        disabled={isSyncing}
                        className="min-h-[36px] px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                        <span>ซิงก์รายชื่อจาก Supabase</span>
                      </button>
                    )}
                    {(studentFullName.trim() || matchedStudent) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (studentCodeInput.trim() || studentFullName.trim()) {
                            applyAutoStatusForStudent(studentCodeInput, studentFullName, matchedStudent);
                          }
                          setActiveInboundStep(3);
                        }}
                        className="min-h-[36px] px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
                      >
                        <span>ถัดไป: ประเภทสิ่งของ</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveInboundStep(2);
                      setTimeout(() => studentSearchInputRef.current?.focus(), 80);
                    }}
                    className="min-h-[34px] px-3 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{studentFullName.trim() || matchedStudent ? 'แก้ไข / เปลี่ยนนักเรียน' : 'เปิดกรอกข้อมูล'}</span>
                  </button>
                )}
              </div>
            </div>

            {activeInboundStep === 2 && (
              <div className="space-y-4 pt-1">

            {/* แถบค้นหาข้อมูลนักเรียนรวม (รหัสนักเรียน, ชื่อ, นามสกุล, ชื่อเล่น หรือหอพัก) */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-1 mb-1.5">
                  <label
                    htmlFor="student-unified-search-input"
                    className="block text-xs font-bold text-slate-800"
                  >
                    ค้นหาด้วยรหัสนักเรียน, ชื่อ, นามสกุล, ชื่อเล่น หรือหอพัก
                  </label>
                  <span className="text-[11px] text-slate-500 font-medium">
                    พิมพ์รหัสนักเรียน (เช่น 00123 หรือ 123) ชื่อ หรือหอพัก เพื่อค้นหา/ดึงข้อมูล
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      ref={studentSearchInputRef}
                      id="student-unified-search-input"
                      type="text"
                      value={studentSearchInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setStudentSearchInput(val);
                        setIsStudentSelected(false);
                        setFormError(null);

                        const clean = val.trim();
                        if (/^\d+$/.test(clean) && clean.length >= 5) {
                          const exact = students.find((s) => {
                            const sc = s.studentCode.trim();
                            const fsc = formatStudentCode(sc);
                            return (
                              sc === clean ||
                              fsc === clean ||
                              sc.padStart(5, '0') === clean ||
                              clean.endsWith(sc) ||
                              sc.replace(/^0+/, '') === clean.replace(/^0+/, '')
                            );
                          });
                          if (exact) {
                            lastAutoPopulatedCodeRef.current = exact.studentCode;
                            populateStudentFields(exact);
                            setIsStudentSelected(true);
                            setActiveInboundStep(3);
                          }
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleFetchStudentData();
                        }
                      }}
                      placeholder="พิมพ์รหัสนักเรียน (เช่น 00123 หรือ 123), ชื่อ, นามสกุล, ชื่อเล่น หรือหอพัก..."
                      className="w-full min-h-[46px] pl-10 pr-9 py-2 text-sm font-medium text-slate-900 bg-white border-2 border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none transition-colors shadow-xs"
                    />
                    {studentSearchInput && (
                      <button
                        type="button"
                        onClick={() => {
                          setStudentSearchInput('');
                          setStudentCodeInput('');
                          setIsStudentSelected(false);
                          if (studentSearchInputRef.current) {
                            studentSearchInputRef.current.focus();
                          }
                        }}
                        aria-label="ล้างช่องค้นหา"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {Boolean(studentSearchInput.trim()) && (
                    <button
                      type="button"
                      onClick={handleFetchStudentData}
                      className="min-h-[46px] px-4 py-2 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white font-bold text-sm rounded-xl transition-all shadow-xs flex items-center justify-center gap-1.5 shrink-0 cursor-pointer animate-in fade-in duration-150"
                    >
                      <Search className="w-4 h-4" />
                      <span>ค้นหา</span>
                    </button>
                  )}
                </div>
              </div>

              {/* รายชื่อนักเรียนแนะนำแสดงเฉพาะเมื่อมีการค้นหาข้อมูลนักเรียน และยังไม่ได้คลิกเลือกข้อมูลนักเรียน ตามคำสั่งผู้ใช้ */}
              {!isStudentSelected && isStudentSearchActive && filteredStudentSuggestions.length > 0 && (
                <div className="pt-1">
                  <span className="block text-xs font-medium text-slate-500 mb-1.5">
                    คลิกเลือกนักเรียนเพื่อดึงข้อมูลอัตโนมัติ ({filteredStudentSuggestions.length} รายการ):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {filteredStudentSuggestions.map((st) => {
                      const isSelected = st.studentCode === studentCodeInput.trim();
                      const stStats = getStudentParcelCounts(st.studentCode, undefined, st);
                      return (
                        <button
                          key={st.studentCode}
                          type="button"
                          onClick={() => {
                            lastAutoPopulatedCodeRef.current = st.studentCode;
                            populateStudentFields(st);
                            setIsStudentSelected(true);
                            setActiveInboundStep(3);
                          }}
                          className={`min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                            isSelected
                              ? 'bg-slate-900 text-white border-slate-900'
                              : stStats.isOverLimit
                              ? 'bg-red-50 text-red-900 border-red-300 hover:bg-red-100 ring-1 ring-red-300'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <span className="font-mono font-bold">{formatStudentCode(st.studentCode)}</span>
                          <span>·</span>
                          <span>
                            {st.firstName} {st.lastName && st.lastName !== '-' ? st.lastName : ''} {st.nickname && st.nickname !== '-' ? `(${st.nickname})` : ''}
                          </span>
                          <span className="font-mono text-[11px] opacity-90 tabular-nums">
                            (ว.{stStats.dayCount} ส.{stStats.weekCount} ด.{stStats.monthCount})
                          </span>
                          {stStats.isOverLimit && (
                            <span className="text-[9px] px-1 bg-red-600 text-white font-bold rounded">
                              เกิน
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {studentFetchFeedback && (
                <div
                  className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 ${
                    studentFetchFeedback.type === 'success'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <span>{studentFetchFeedback.message}</span>
                  <button
                    type="button"
                    onClick={() => setStudentFetchFeedback(null)}
                    className="opacity-60 hover:opacity-100"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* ข้อมูลนักเรียนผู้รับพัสดุ: แสดงเป็นแบบข้อความ ชื่อ นามสกุล ระดับชั้น/ห้อง หอพัก */}
            <div className="space-y-3 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800">
                  ข้อมูลนักเรียนผู้รับพัสดุ:
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsManualEditStudentOpen((prev) => !prev)}
                    className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors cursor-pointer"
                  >
                    {isManualEditStudentOpen ? 'ซ่อนฟอร์มแก้ไข' : 'แก้ไข / กรอกข้อมูลเอง'}
                  </button>
                  {studentFullName.trim() && (
                    <button
                      type="button"
                      onClick={handleSaveStudentOnly}
                      className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>บันทึกคนนี้ลงทะเบียนนักเรียน</span>
                    </button>
                  )}
                </div>
              </div>

              {/* การแสดงผลแบบข้อความ ชื่อ นามสกุล ระดับชั้น/ห้อง หอพัก */}
              <div className="p-4 bg-slate-50 border border-slate-300 rounded-xl space-y-3">
                {studentFullName.trim() || matchedStudent ? (
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500">ชื่อ นามสกุล:</span>
                      <span className="text-base font-bold text-slate-900">
                        {studentFullName.trim() ||
                          `${matchedStudent?.prefix || ''}${matchedStudent?.firstName || ''} ${
                            matchedStudent?.lastName || ''
                          }`}{' '}
                        {(studentNickname.trim() || matchedStudent?.nickname) && (
                          <span className="font-normal text-slate-600 text-sm">
                            ({studentNickname.trim() || matchedStudent?.nickname})
                          </span>
                        )}
                      </span>
                      {(studentCodeInput.trim() || matchedStudent?.studentCode) && (
                        <span className="font-mono text-xs font-semibold text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                          รหัส: {formatStudentCode(studentCodeInput.trim() || matchedStudent?.studentCode)}
                        </span>
                      )}
                      {activeDormitoryName && (
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-extrabold border shadow-2xs ${dormTheme.bgClass} ${dormTheme.borderClass}`}
                          style={{ borderColor: dormTheme.hexColor, color: dormTheme.hexColor }}
                        >
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dormTheme.hexColor }} />
                          <span>{activeDormitoryName}</span>
                          {dormTheme.basketCode && dormTheme.basketCode !== '-' && (
                            <span className="opacity-80 font-mono text-[11px]">({dormTheme.basketCode})</span>
                          )}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
                        <span className="text-xs font-medium text-slate-500 block mb-1">ระดับชั้น/ห้อง:</span>
                        <span className="text-base font-bold text-slate-900 font-mono">
                          {studentGradeRoom.trim() ||
                            (matchedStudent
                              ? `${matchedStudent.grade}${matchedStudent.room ? `/${matchedStudent.room}` : ''}`
                              : '-')}
                        </span>
                      </div>

                      {/* หอพัก: เน้นและขยายข้อความ หอพักล้านนา และใช้สีตามหอพัก */}
                      <div
                        className={`p-3.5 rounded-xl border-2 transition-all shadow-xs ${dormTheme.bgClass} ${dormTheme.borderClass}`}
                        style={{ borderColor: dormTheme.hexColor }}
                      >
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs"
                              style={{ backgroundColor: dormTheme.hexColor }}
                            />
                            หอพักผู้รับพัสดุ:
                          </span>
                          {dormTheme.basketCode && dormTheme.basketCode !== '-' && (
                            <span
                              className={`px-2 py-0.5 rounded-md text-[11px] font-extrabold ${dormTheme.accentBgClass} shadow-2xs`}
                            >
                              {dormTheme.basketCode}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-baseline gap-2">
                          {/* เน้นและขยายข้อความ หอพักล้านนา ตัวโต ชัดเจน พร้อมใช้สีประจำหอพัก */}
                          <span
                            className={`text-xl sm:text-2xl font-black tracking-tight ${dormTheme.textClass}`}
                            style={{ color: dormTheme.hexColor }}
                          >
                            {studentDormitory.trim() || matchedStudent?.dormitory || '-'}
                          </span>

                          {(studentDormRoom.trim() || matchedStudent?.dormRoom) && (
                            <span className="px-2 py-0.5 rounded-md bg-white/95 text-slate-800 border border-slate-300 font-mono text-xs font-bold shadow-2xs">
                              ห้อง {studentDormRoom.trim() || matchedStudent?.dormRoom}
                            </span>
                          )}

                          {dormTheme.colorName && dormTheme.colorName !== 'สีเทามาตรฐาน (Slate)' && (
                            <span className="text-xs font-semibold text-slate-500">
                              ({dormTheme.colorName})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ข้อความแสดงผลสรุป (รูปแบบปกติ) */}
                    <div className="text-xs text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200 font-medium flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-bold text-slate-900">ข้อความข้อมูลผู้รับ:</span>
                      <span>
                        {studentFullName.trim() ||
                          `${matchedStudent?.prefix || ''}${matchedStudent?.firstName || ''} ${
                            matchedStudent?.lastName || ''
                          }`}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span>
                        ระดับชั้น/ห้อง:{' '}
                        {studentGradeRoom.trim() ||
                          (matchedStudent ? `${matchedStudent.grade}/${matchedStudent.room}` : '-')}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span>
                        หอพัก:{' '}
                        {studentDormitory.trim() || matchedStudent?.dormitory || '-'}{' '}
                        {(studentDormRoom.trim() || matchedStudent?.dormRoom) && (
                          <span className="font-mono text-slate-500">
                            (ห้อง {studentDormRoom.trim() || matchedStudent?.dormRoom})
                          </span>
                        )}
                      </span>
                    </div>

                    {/* สรุปการนับจำนวนพัสดุของนักเรียน (วัน / สัปดาห์ / เดือน) และสถานะเฝ้าระวัง ปรับตามอัตราการสั่งพัสดุ */}
                    <div
                      className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-colors ${
                        activeStudentParcelStats.isOverLimit
                          ? 'bg-red-50/90 border-red-300 ring-1 ring-red-400 text-red-950'
                          : 'bg-indigo-50/50 border-indigo-200 text-slate-800'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1.5 font-bold">
                          {activeStudentParcelStats.isOverLimit ? (
                            <AlertTriangle className="w-4 h-4 text-red-600 animate-pulse shrink-0" />
                          ) : (
                            <Package className="w-4 h-4 text-indigo-600 shrink-0" />
                          )}
                          <span>สรุปพัสดุของนักเรียน:</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 font-mono">
                          {/* วัน */}
                          <span
                            className={`px-2 py-0.5 rounded-md font-bold ${
                              activeStudentParcelStats.isOverDailyLimit
                                ? 'bg-red-200/90 text-red-900 ring-1 ring-red-400'
                                : 'bg-white text-slate-800 border border-slate-200'
                            }`}
                          >
                            <span className="font-sans font-normal text-slate-500 mr-1">วัน</span>
                            {activeStudentParcelStats.dayCount} ชิ้น
                            {parcelRateLimitConfig.daily.enabled && (
                              <span className="text-[10px] text-slate-400 font-normal">
                                {' '}(โควตา: {parcelRateLimitConfig.daily.limit})
                              </span>
                            )}
                          </span>

                          <span className="text-slate-300">·</span>

                          {/* สัปดาห์ */}
                          <span
                            className={`px-2 py-0.5 rounded-md font-bold ${
                              activeStudentParcelStats.isOverWeeklyLimit
                                ? 'bg-red-200/90 text-red-900 ring-1 ring-red-400'
                                : 'bg-white text-slate-800 border border-slate-200'
                            }`}
                          >
                            <span className="font-sans font-normal text-slate-500 mr-1">สัปดาห์</span>
                            {activeStudentParcelStats.weekCount} ชิ้น
                            {parcelRateLimitConfig.weekly.enabled && (
                              <span className="text-[10px] text-slate-400 font-normal">
                                {' '}(โควตา: {parcelRateLimitConfig.weekly.limit})
                              </span>
                            )}
                          </span>

                          <span className="text-slate-300">·</span>

                          {/* เดือน */}
                          <span
                            className={`px-2 py-0.5 rounded-md font-bold ${
                              activeStudentParcelStats.isOverMonthlyLimit
                                ? 'bg-red-200/90 text-red-900 ring-1 ring-red-400'
                                : 'bg-white text-slate-800 border border-slate-200'
                            }`}
                          >
                            <span className="font-sans font-normal text-slate-500 mr-1">เดือน</span>
                            {activeStudentParcelStats.monthCount} ชิ้น
                            {parcelRateLimitConfig.monthly.enabled && (
                              <span className="text-[10px] text-slate-400 font-normal">
                                {' '}(โควตา: {parcelRateLimitConfig.monthly.limit})
                              </span>
                            )}
                          </span>
                        </div>
                      </div>

                      {/* สถานะเฝ้าระวัง */}
                      <div>
                        {activeStudentParcelStats.isOverLimit ? (
                          <button
                            type="button"
                            onClick={() => openWeeklyWarningPopup(activeStudentParcelStats, 'manual')}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 active:scale-98 text-white text-[11px] font-bold rounded-lg flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                          >
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              สถานะเฝ้าระวัง (เกินเกณฑ์: คลิกดู POPUP)
                            </span>
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>สถานะเฝ้าระวัง: ปกติ (อยู่ในเกณฑ์)</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span>
                      ยังไม่มีข้อมูลนักเรียนผู้รับพัสดุ (กรุณาค้นหาด้วยรหัสนักเรียน หรือชื่อ / นามสกุล / ชื่อเล่น / หอพัก ด้านบน)
                    </span>
                    {!isManualEditStudentOpen && (
                      <button
                        type="button"
                        onClick={() => setIsManualEditStudentOpen(true)}
                        className="text-xs font-bold text-slate-800 hover:text-slate-950 underline self-start sm:self-auto cursor-pointer"
                      >
                        + กรอกข้อมูลนักเรียนเอง
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* ฟอร์มกรอก/แก้ไขข้อมูลนักเรียนด้วยตนเอง (ขยายเมื่อกด 'แก้ไข / กรอกข้อมูลเอง') */}
              {isManualEditStudentOpen && (
                <div className="p-4 bg-slate-50 border border-slate-300 rounded-xl space-y-3">
                  <div className="text-xs font-bold text-slate-700 pb-1 border-b border-slate-200 flex items-center justify-between">
                    <span>ฟอร์มแก้ไขหรือกรอกข้อมูลนักเรียนด้วยตนเอง:</span>
                    <button
                      type="button"
                      onClick={() => setIsManualEditStudentOpen(false)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-3">
                      <label className="block text-xs font-medium text-slate-600 mb-1">รหัสนักเรียน</label>
                      <input
                        ref={studentCodeInputRef}
                        type="text"
                        value={studentCodeInput}
                        onChange={(e) => {
                          setStudentCodeInput(e.target.value);
                        }}
                        onBlur={() => {
                          if (studentCodeInput.trim() || studentFullName.trim()) {
                            applyAutoStatusForStudent(studentCodeInput, studentFullName, matchedStudent);
                          }
                        }}
                        placeholder="เช่น 00123 หรือ 123"
                        className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono font-bold text-slate-900 bg-white border border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">คำนำหน้า</label>
                      <select
                        aria-label="คำนำหน้าชื่อนักเรียน"
                        value={studentPrefix}
                        onChange={(e) => setStudentPrefix(e.target.value)}
                        className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none"
                      >
                        <option value="นาย">นาย</option>
                        <option value="นางสาว">นางสาว</option>
                        <option value="ด.ช.">ด.ช.</option>
                        <option value="ด.ญ.">ด.ญ.</option>
                      </select>
                    </div>

                    <div className="sm:col-span-5">
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        ชื่อ-นามสกุลนักเรียน *
                      </label>
                      <input
                        type="text"
                        value={studentFullName}
                        onChange={(e) => {
                          setStudentFullName(e.target.value);
                        }}
                        onBlur={() => {
                          if (studentCodeInput.trim() || studentFullName.trim()) {
                            applyAutoStatusForStudent(studentCodeInput, studentFullName, matchedStudent);
                          }
                        }}
                        placeholder="กรอกชื่อ-นามสกุลผู้รับ..."
                        className="w-full min-h-[44px] px-3.5 py-2 text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">ชื่อเล่น</label>
                      <input
                        type="text"
                        value={studentNickname}
                        onChange={(e) => setStudentNickname(e.target.value)}
                        placeholder="ชื่อเล่น..."
                        className="w-full min-h-[44px] px-3.5 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-4">
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        ระดับชั้น/ห้อง
                      </label>
                      <input
                        type="text"
                        value={studentGradeRoom}
                        onChange={(e) => setStudentGradeRoom(e.target.value)}
                        placeholder="ระบุระดับชั้น/ห้อง..."
                        className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono text-slate-900 bg-white border border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-5">
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        หอพัก *
                      </label>
                      <input
                        type="text"
                        list="dormitory-options-list"
                        value={studentDormitory}
                        onChange={(e) => setStudentDormitory(e.target.value)}
                        placeholder="ระบุชื่อหอพัก..."
                        className="w-full min-h-[44px] px-3.5 py-2 text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none"
                      />
                      <datalist id="dormitory-options-list">
                        {availableDormitories.map((d) => (
                          <option key={d} value={d} />
                        ))}
                      </datalist>
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-xs font-medium text-slate-600 mb-1">ห้องพักหอ</label>
                      <input
                        type="text"
                        value={studentDormRoom}
                        onChange={(e) => setStudentDormRoom(e.target.value)}
                        placeholder="ห้องพักหอ"
                        className="w-full min-h-[44px] px-3 py-2 text-sm font-mono font-bold text-slate-900 bg-white border border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        if (!studentFullName.trim()) {
                          setFormError('กรุณากรอกชื่อ-นามสกุลนักเรียนก่อนดำเนินการต่อ');
                          return;
                        }
                        if (!studentDormitory.trim()) {
                          setFormError('กรุณาระบุชื่อหอพักก่อนดำเนินการต่อ');
                          return;
                        }
                        setFormError(null);
                        applyAutoStatusForStudent(studentCodeInput, studentFullName, matchedStudent);
                        setIsManualEditStudentOpen(false);
                        setActiveInboundStep(3);
                      }}
                      className="min-h-[42px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <span>ยืนยันข้อมูลนักเรียน / ถัดไป: กรอกประเภทสิ่งของ</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
              </div>
            )}
          </section>

          {/* 3. กรอกประเภทสิ่งของ */}
          <section
            ref={step3SectionRef}
            data-section-id="step3"
            className={`scroll-mt-28 bg-white border rounded-2xl transition-all ${
              activeInboundStep === 3
                ? 'border-slate-900/30 ring-2 ring-slate-900/10 p-5 md:p-6 space-y-4 shadow-xs'
                : 'border-slate-200 p-4 sm:px-5 sm:py-4 hover:border-slate-300'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setActiveInboundStep((prev) => (prev === 3 ? null : 3))}
                  className="text-base font-bold text-slate-900 flex items-center gap-2 cursor-pointer text-left"
                >
                  <span
                    className={`w-6 h-6 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0 ${
                      isCategoryValid
                        ? 'bg-emerald-600 text-white'
                        : activeInboundStep === 3
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {isCategoryValid && activeInboundStep !== 3 ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      '3'
                    )}
                  </span>
                  <Package className="w-5 h-5 text-slate-700 shrink-0" />
                  <span>กรอกประเภทสิ่งของ</span>
                </button>

                {activeInboundStep !== 3 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {category ? (
                      <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-900 border border-emerald-200">
                        {customCategoryDetail.trim()
                          ? `${category} (${customCategoryDetail.trim()})`
                          : category}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 font-medium">ยังไม่ได้เลือกประเภทสิ่งของ</span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {activeInboundStep === 3 ? (
                  !category ? (
                    <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                      * กรุณาคลิกเลือกหมวดหมู่
                    </span>
                  ) : isCategoryValid ? (
                    <button
                      type="button"
                      onClick={() => setActiveInboundStep(4)}
                      className="min-h-[36px] px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
                    >
                      <span>ถัดไป: เลือกสถานะคัดแยก</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ) : null
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveInboundStep(3)}
                    className="min-h-[34px] px-3 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{category ? 'แก้ไข / เปลี่ยนประเภท' : 'เปิดเลือกประเภท'}</span>
                  </button>
                )}
              </div>
            </div>

            {activeInboundStep === 3 && (
              <div className="space-y-3 pt-1">
                <span className="block text-xs text-slate-500">
                  เลือกหมวดหมู่สิ่งของ แล้วระบุรายละเอียดเพิ่มเติม (ถ้ามี) จากนั้นกดปุ่ม &quot;ถัดไป&quot; หรือกด Enter เพื่อย่อกล่องและเลือกสถานะคัดแยก
                </span>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1.5 sm:gap-2">
                  {PARCEL_CATEGORIES.map((cat) => {
                    const active = category === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        title={cat}
                        onClick={() => {
                          setCategory(cat);
                          setFormError(null);
                          setTimeout(() => customCategoryInputRef.current?.focus(), 60);
                        }}
                        className={`min-h-[38px] px-2.5 py-1.5 text-xs font-semibold rounded-lg border text-left transition-colors cursor-pointer truncate ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                            : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>

                {/* ช่องกรอกรายละเอียดประเภทสิ่งของ: disable ก่อนจนกว่าจะมีการเลือก เมื่อเลือกประเภทสิ่งของแล้ว ให้เปิดช่องกรอกประเภทสิ่งของทันที */}
                {(() => {
                  const isDetailRequired = category === 'อื่นๆ';
                  const isCosmetics = category === 'เครื่องสำอาง';
                  const isInputDisabled = !category;

                  return (
                    <div
                      className={`p-3 sm:p-3.5 rounded-xl border space-y-2 transition-all ${
                        !category
                          ? 'bg-slate-100/70 border-slate-200 opacity-60'
                          : isDetailRequired || isCosmetics
                          ? 'bg-amber-50/70 border-amber-300 ring-2 ring-amber-400/20'
                          : 'bg-emerald-50/40 border-emerald-300 ring-2 ring-emerald-500/10'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="custom-category-detail-input"
                          className={`block text-xs font-bold ${
                            !category
                              ? 'text-slate-500'
                              : isDetailRequired
                              ? 'text-amber-950 font-extrabold'
                              : isCosmetics
                              ? 'text-amber-900 font-bold'
                              : 'text-slate-900'
                          }`}
                        >
                          {!category
                            ? 'กรอกประเภทสิ่งของ (ปิดใช้งาน - กรุณาคลิกเลือกหมวดหมู่สิ่งของด้านบนก่อน)'
                            : isDetailRequired
                            ? 'ระบุประเภทสิ่งของ (อื่นๆ ว่าเป็นอะไร) *'
                            : isCosmetics
                            ? 'ระบุรายละเอียดเครื่องสำอาง (ว่าเป็นอะไร เช่น ครีม, ลิปสติก)'
                            : `ระบุรายละเอียดเพิ่มเติมสำหรับ "${category}" (ถ้ามี หรือเว้นว่าง แล้วกดถัดไป)`}
                        </label>

                        {category && (
                          <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-md shrink-0">
                            เปิดช่องกรอกแล้ว
                          </span>
                        )}
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          ref={customCategoryInputRef}
                          id="custom-category-detail-input"
                          type="text"
                          disabled={isInputDisabled}
                          value={customCategoryDetail}
                          onChange={(e) => {
                            setCustomCategoryDetail(e.target.value);
                            setFormError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (isCategoryValid) {
                                setActiveInboundStep(4);
                              } else if (category === 'อื่นๆ') {
                                setFormError('กรุณาระบุรายละเอียดประเภทสิ่งของในช่อง "อื่นๆ" ก่อนดำเนินการต่อ');
                              }
                            }
                          }}
                          placeholder={
                            !category
                              ? 'ปิดใช้งานชั่วคราว - กรุณาคลิกเลือกหมวดหมู่สิ่งของด้านบนก่อน...'
                              : isDetailRequired
                              ? 'กรอกว่าเป็นอะไร (จำเป็นต้องระบุ)...'
                              : isCosmetics
                              ? 'กรอกรายละเอียดเครื่องสำอางว่าเป็นอะไร (เช่น ครีม, ลิปสติก)...'
                              : `กรอกรายละเอียดสิ่งของเพิ่มเติมสำหรับ "${category}" เช่น ขนมปัง, เสื้อกันหนาว (เว้นว่างได้)...`
                          }
                          className={`flex-1 min-h-[42px] px-3.5 py-2 text-xs sm:text-sm rounded-xl border transition-colors focus:outline-none ${
                            isInputDisabled
                              ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed select-none placeholder:text-slate-400'
                              : isDetailRequired || isCosmetics
                              ? 'bg-white text-slate-900 border-amber-300 focus:border-amber-600 focus:ring-2 focus:ring-amber-500/20'
                              : 'bg-white text-slate-900 border-slate-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20'
                          }`}
                        />
                        {category && (
                          <button
                            type="button"
                            disabled={!isCategoryValid}
                            onClick={() => setActiveInboundStep(4)}
                            className="min-h-[42px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed shrink-0"
                          >
                            <span>ถัดไป: เลือกสถานะคัดแยก</span>
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </section>

          {/* 4. เลือกสถานะการคัดแยกพัสดุ */}
          <section
            ref={step4SectionRef}
            data-section-id="step4"
            className={`scroll-mt-28 bg-white border rounded-2xl transition-all ${
              activeInboundStep === 4
                ? 'border-slate-900/30 ring-2 ring-slate-900/10 p-5 md:p-6 space-y-4 shadow-xs'
                : 'border-slate-200 p-4 sm:px-5 sm:py-4 hover:border-slate-300'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setActiveInboundStep((prev) => (prev === 4 ? null : 4))}
                  className="text-base font-bold text-slate-900 flex items-center gap-2 cursor-pointer text-left"
                >
                  <span
                    className={`w-6 h-6 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0 ${
                      isStatusValid
                        ? 'bg-emerald-600 text-white'
                        : activeInboundStep === 4
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    4
                  </span>
                  <Layers className="w-5 h-5 text-slate-700 shrink-0" />
                  <span>เลือกสถานะการคัดแยกพัสดุ</span>
                </button>

                {activeInboundStep !== 4 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {status ? (
                      <span
                        className={`px-2.5 py-0.5 rounded-lg text-xs font-bold border ${
                          status === 'ติดนิติการ'
                            ? 'bg-red-50 text-red-800 border-red-200'
                            : status === 'ติดต่องานพยาบาล'
                            ? 'bg-amber-50 text-amber-900 border-amber-200'
                            : status === 'พัสดุไม่ทราบเจ้าของ'
                            ? 'bg-slate-100 text-slate-700 border-slate-200'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        }`}
                      >
                        {status}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 font-medium">รอเลือกสถานะการคัดแยก</span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {activeInboundStep === 4 && status && (
                  <div className="shrink-0">
                    {status === 'ติดนิติการ' && activeStudentParcelStats.isOverLimit && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-red-100 text-red-800 border border-red-300 shadow-2xs">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                        <span>เลือกอัตโนมัติ: พัสดุติดนิติการ (เกินเกณฑ์)</span>
                      </span>
                    )}
                    {status === 'ลงทะเบียนรับพัสดุ' && (studentFullName.trim() || matchedStudent) && !activeStudentParcelStats.isOverLimit && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>เลือกอัตโนมัติ: ลงทะเบียนรับพัสดุ (อยู่ในเกณฑ์)</span>
                      </span>
                    )}
                    {status === 'ติดต่องานพยาบาล' && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs">
                        <span>ผู้ใช้เลือกเอง: ติดต่องานพยาบาล</span>
                      </span>
                    )}
                    {status === 'พัสดุไม่ทราบเจ้าของ' && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-200 text-slate-800 border border-slate-300 shadow-2xs">
                        <span>ผู้ใช้เลือกเอง: พัสดุไม่ทราบเจ้าของ</span>
                      </span>
                    )}
                  </div>
                )}

                {activeInboundStep !== 4 && (
                  <button
                    type="button"
                    onClick={() => setActiveInboundStep(4)}
                    className="min-h-[34px] px-3 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>{status ? 'เปลี่ยน / บันทึก' : 'เปิดเลือกสถานะ'}</span>
                  </button>
                )}
              </div>
            </div>

            {activeInboundStep === 4 && (
              <div className="space-y-4 pt-1">
                <span className="block text-xs text-slate-500">
                  คลิกเลือกประเภทการคัดแยกพัสดุเพื่อบันทึกและเตรียมพร้อมสแกนพัสดุชิ้นต่อไป (กรณีพัสดุติดนิติการสามารถเลือกสาเหตุเพิ่มเติมได้)
                </span>

                {/* ลดขนาดปุ่มสถานะ วาง 4 ปุ่มใน 1 แถวบนจอใหญ่ หรือ 1 แถว 2 ปุ่ม จำนวน 2 แถวบนจอมือถือ/แท็บเล็ต */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-2.5">
                  {INBOUND_STATUS_OPTIONS.map((opt) => {
                    const active = status === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setStatus(opt.value);
                          setFormError(null);
                          if (opt.value !== 'ติดนิติการ') {
                            const canQuickSave =
                              isTrackingValid &&
                              !isDuplicateTracking &&
                              (opt.value === 'พัสดุไม่ทราบเจ้าของ' ||
                                Boolean(
                                  (studentFullName.trim() ||
                                    (matchedStudent &&
                                      `${matchedStudent.prefix || ''}${matchedStudent.firstName}`.trim())) &&
                                    (studentCodeInput.trim() || matchedStudent?.studentCode) &&
                                    (studentDormitory.trim() ||
                                      (matchedStudent?.dormitory && matchedStudent.dormitory !== '-'))
                                )) &&
                              isCategoryValid;
                            if (canQuickSave) {
                              void submitInboundParcel(opt.value);
                            }
                          }
                        }}
                        className={`min-h-[48px] sm:min-h-[52px] px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-xl border-2 text-left transition-all cursor-pointer flex flex-col justify-center ${
                          active ? opt.activeClass : opt.inactiveClass
                        }`}
                      >
                        <div className="font-bold text-xs sm:text-sm leading-tight truncate">{opt.label}</div>
                        <div className={`text-[10.5px] sm:text-[11px] mt-0.5 leading-tight truncate ${active ? opt.descActiveClass : opt.descInactiveClass}`}>
                          {opt.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>

            {/* แสดงช่องหมายเหตุเฉพาะเมื่อเลือกสถานะ "พัสดุติดนิติการ" ตามคำสั่งผู้ใช้ */}
            {status === 'ติดนิติการ' && (
              <div className="p-4 bg-red-50/90 border-2 border-red-300 rounded-xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <label className="text-xs font-bold text-red-950 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                    <span>ระบุหมายเหตุ / สาเหตุที่พัสดุติดนิติการ:</span>
                  </label>
                  <span className="text-[11px] font-medium text-red-700">
                    (คลิกเลือกสาเหตุ หรือหากไม่ได้แจ้งสาเหตุสามารถเว้นว่างได้)
                  </span>
                </div>

                {/* 3 ตัวเลือก: สั่งของเกินกำหนด, ของผิดระเบียบ, อื่นๆ (ผู้ใช้กรอกเอง) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {/* ตัวเลือก: สั่งของเกินกำหนด */}
                  <button
                    type="button"
                    onClick={() => {
                      setLegalHoldReasonType((prev) => (prev === 'สั่งของเกินกำหนด' ? null : 'สั่งของเกินกำหนด'));
                      setFormError(null);
                    }}
                    className={`min-h-[46px] px-3.5 py-2.5 rounded-xl border-2 text-left transition-all flex items-center justify-between gap-2 cursor-pointer select-none ${
                      legalHoldReasonType === 'สั่งของเกินกำหนด'
                        ? 'bg-red-600 text-white border-red-700 ring-2 ring-red-500/40 font-bold shadow-sm'
                        : 'bg-white hover:bg-red-100 text-slate-800 border-red-200 hover:border-red-300'
                    }`}
                  >
                    <span className="text-xs sm:text-sm font-semibold">สั่งของเกินกำหนด</span>
                    {legalHoldReasonType === 'สั่งของเกินกำหนด' && (
                      <Check className="w-4 h-4 text-white shrink-0" />
                    )}
                  </button>

                  {/* ตัวเลือก: ของผิดระเบียบ */}
                  <button
                    type="button"
                    onClick={() => {
                      setLegalHoldReasonType((prev) => (prev === 'ของผิดระเบียบ' ? null : 'ของผิดระเบียบ'));
                      setFormError(null);
                    }}
                    className={`min-h-[46px] px-3.5 py-2.5 rounded-xl border-2 text-left transition-all flex items-center justify-between gap-2 cursor-pointer select-none ${
                      legalHoldReasonType === 'ของผิดระเบียบ'
                        ? 'bg-red-600 text-white border-red-700 ring-2 ring-red-500/40 font-bold shadow-sm'
                        : 'bg-white hover:bg-red-100 text-slate-800 border-red-200 hover:border-red-300'
                    }`}
                  >
                    <span className="text-xs sm:text-sm font-semibold">ของผิดระเบียบ</span>
                    {legalHoldReasonType === 'ของผิดระเบียบ' && (
                      <Check className="w-4 h-4 text-white shrink-0" />
                    )}
                  </button>

                  {/* ตัวเลือก: อื่นๆ (ผู้ใช้กรอกเอง) */}
                  <button
                    type="button"
                    onClick={() => {
                      setLegalHoldReasonType((prev) => (prev === 'อื่นๆ' ? null : 'อื่นๆ'));
                      setFormError(null);
                    }}
                    className={`min-h-[46px] px-3.5 py-2.5 rounded-xl border-2 text-left transition-all flex items-center justify-between gap-2 cursor-pointer select-none ${
                      legalHoldReasonType === 'อื่นๆ'
                        ? 'bg-red-600 text-white border-red-700 ring-2 ring-red-500/40 font-bold shadow-sm'
                        : 'bg-white hover:bg-red-100 text-slate-800 border-red-200 hover:border-red-300'
                    }`}
                  >
                    <span className="text-xs sm:text-sm font-semibold">อื่นๆ (ผู้ใช้กรอกเอง)</span>
                    {legalHoldReasonType === 'อื่นๆ' && (
                      <Check className="w-4 h-4 text-white shrink-0" />
                    )}
                  </button>
                </div>

                {/* ช่องกรอกข้อความเมื่อเลือก "3. อื่นๆ (ผู้ใช้กรอกเอง)" */}
                {legalHoldReasonType === 'อื่นๆ' && (
                  <div className="pt-1.5">
                    <label
                      htmlFor="custom-legal-note-input"
                      className="block text-xs font-bold text-red-950 mb-1"
                    >
                      ระบุหมายเหตุ / เหตุผลเพิ่มเติม (ผู้ใช้กรอกเอง): <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="custom-legal-note-input"
                      type="text"
                      value={customLegalNote}
                      onChange={(e) => {
                        setCustomLegalNote(e.target.value);
                        setFormError(null);
                      }}
                      placeholder="เช่น อุปกรณ์ต้องห้าม, บรรจุภัณฑ์ต้องสงสัย, พัสดุไม่ได้รับอนุญาตนำเข้าหอพัก..."
                      className="w-full min-h-[44px] px-3.5 py-2 text-sm font-medium text-slate-900 bg-white border-2 border-red-300 rounded-xl focus:border-red-700 focus:outline-none transition-colors shadow-xs"
                      autoFocus
                    />
                  </div>
                )}
              </div>
            )}

            {/* ปุ่มบันทึกลงทะเบียนพัสดุ: ไม่อนุญาตให้บันทึกหากบาร์โค้ดหรือเลขพัสดุถูกใช้งานแล้ว หรือข้อมูลยังไม่ครบ */}
            {isDuplicateTracking ? (
              <div className="space-y-2.5 mt-3 animate-in fade-in duration-150">
                <div className="p-3.5 bg-red-50 border-2 border-red-300 rounded-xl text-xs text-red-900 font-semibold flex flex-wrap items-center justify-between gap-2 shadow-xs">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 animate-pulse" />
                    <span>ไม่อนุญาตให้บันทึกลงทะเบียนพัสดุ: บาร์โค้ดหรือเลขพัสดุนี้ได้ถูกใช้งานแล้วในระบบ</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (detectedDuplicateParcel) {
                        setDuplicateParcel(detectedDuplicateParcel);
                        setIsDuplicateModalOpen(true);
                      }
                    }}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg cursor-pointer transition-colors shadow-2xs shrink-0"
                  >
                    ดูข้อมูลพัสดุเดิม
                  </button>
                </div>
                <button
                  type="button"
                  disabled
                  title="ไม่อนุญาตให้บันทึกลงทะเบียนพัสดุ เนื่องจากบาร์โค้ดหรือเลขพัสดุนี้ได้ถูกใช้งานแล้วในระบบ"
                  className="w-full min-h-[54px] sm:min-h-[58px] px-6 py-3.5 bg-red-50 text-red-500 border-2 border-dashed border-red-300 font-bold text-base rounded-xl cursor-not-allowed flex items-center justify-center gap-2.5 select-none transition-all"
                >
                  <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                  <span>ไม่อนุญาตให้บันทึก (เลขพัสดุถูกใช้งานแล้ว)</span>
                </button>
              </div>
            ) : isFormComplete ? (
              <div className="space-y-2 mt-3">
                <button
                  type="submit"
                  className="w-full min-h-[54px] sm:min-h-[58px] px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-base rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2.5 cursor-pointer ring-2 ring-emerald-500/40"
                >
                  <PackagePlus className="w-5 h-5" />
                  <span>บันทึกลงทะเบียนพัสดุ</span>
                </button>
                <div className="flex items-center justify-center gap-2 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>กรอกและเลือกข้อมูลครบทุกช่องแล้ว พร้อมบันทึกข้อมูลเข้าสู่ระบบ</span>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5 mt-3">
                <button
                  type="button"
                  disabled
                  title="กรุณากรอกและเลือกข้อมูลให้ครบทุกช่องก่อนบันทึก"
                  className="w-full min-h-[54px] sm:min-h-[58px] px-6 py-3.5 bg-slate-100 text-slate-400 border-2 border-dashed border-slate-300 font-bold text-base rounded-xl cursor-not-allowed flex items-center justify-center gap-2.5 select-none transition-all"
                >
                  <PackagePlus className="w-5 h-5 text-slate-400" />
                  <span>บันทึกลงทะเบียนพัสดุ (ปิดใช้งานชั่วคราว)</span>
                </button>

                {/* แถบสรุปรายการที่ต้องกรอก/เลือกเพื่อให้ปุ่มเปิดใช้งาน */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 space-y-1.5">
                  <div className="font-semibold text-slate-700 flex items-center justify-between">
                    <span>กรุณากรอกและเลือกข้อมูลให้ครบทุกช่องเพื่อเปิดปุ่มบันทึก:</span>
                    <span className="text-[11px] font-mono text-slate-400">
                      {[isTrackingValid && !isDuplicateTracking, isStudentValid, isCategoryValid, isStatusValid].filter(Boolean).length}/4
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        isTrackingValid && !isDuplicateTracking
                          ? 'bg-emerald-100 text-emerald-800 font-semibold'
                          : isDuplicateTracking
                          ? 'bg-red-100 text-red-900 border border-red-300 font-semibold'
                          : 'bg-slate-200/80 text-slate-600 hover:bg-slate-200'
                      }`}
                      onClick={() => {
                        if (isDuplicateTracking) {
                          checkAndNotifyDuplicate(trackingNumber);
                        } else {
                          setActiveInboundStep(1);
                        }
                      }}
                    >
                      <span>1. เลขพัสดุ</span>
                      {isTrackingValid && !isDuplicateTracking ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      ) : isDuplicateTracking ? (
                        <span className="text-[10px] text-red-700 underline font-bold">(เลขซ้ำ - ดูข้อมูล)</span>
                      ) : (
                        <span className="text-[10px] text-slate-500 underline">(คลิกกรอก)</span>
                      )}
                    </span>

                    <span
                      onClick={() => setActiveInboundStep(2)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        isStudentValid
                          ? 'bg-emerald-100 text-emerald-800 font-semibold'
                          : 'bg-slate-200/80 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      <span>2. ข้อมูลผู้รับ</span>
                      {isStudentValid ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <span className="text-[10px] text-slate-500 underline">(คลิกกรอก)</span>
                      )}
                    </span>

                    <span
                      onClick={() => setActiveInboundStep(3)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        isCategoryValid
                          ? 'bg-emerald-100 text-emerald-800 font-semibold'
                          : 'bg-slate-200/80 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      <span>3. ประเภทสิ่งของ</span>
                      {isCategoryValid ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <span className="text-[10px] text-slate-500 underline">
                          {!category ? '(คลิกเลือก)' : '(ระบุรายละเอียด)'}
                        </span>
                      )}
                    </span>

                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        isStatusValid
                          ? 'bg-emerald-100 text-emerald-800 font-semibold'
                          : 'bg-slate-200/80 text-slate-500'
                      }`}
                    >
                      <span>4. สถานะพัสดุ{status === 'ติดนิติการ' ? ' (และหมายเหตุ)' : ''}</span>
                      {isStatusValid ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <span className="text-[10px] text-slate-400">
                          {status === 'ติดนิติการ' && legalHoldReasonType === 'อื่นๆ' && !customLegalNote.trim()
                            ? '(รอระบุหมายเหตุ)'
                            : '(ยังไม่ได้เลือก)'}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}
              </div>
            )}
          </section>
      </form>

      {/* จุดคัดแยกลงตะกร้าหอพัก (Color-Coding Guide) - แสดงเมื่อกดปุ่มเลือกดู */}
      {isDormGuideOpen && (
      <section
        ref={dormGuideSectionRef}
        data-section-id="dorm"
        aria-label="ป้ายสีประจำหอพักสำหรับคัดแยกตะกร้า"
        className={`scroll-mt-28 rounded-2xl border-4 ${dormTheme.borderClass} ${dormTheme.bgClass} p-5 md:p-6 space-y-5 transition-colors`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-black/10 pb-4">
          <div>
            <span className="text-xs font-bold text-slate-600">
              จุดคัดแยกลงตะกร้าหอพัก (Color-Coding Guide)
            </span>
            <h2 className={`text-2xl sm:text-3xl font-extrabold ${dormTheme.textClass} mt-0.5`}>
              {dormTheme.name}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <div className={`px-4 py-2 rounded-xl font-mono font-extrabold text-lg sm:text-xl ${dormTheme.accentBgClass} shadow-2xs`}>
              {dormTheme.basketCode}
            </div>
            <button
              type="button"
              onClick={() => setIsDormGuideOpen(false)}
              className="no-print min-h-[38px] px-3 py-1.5 bg-white/90 hover:bg-white text-slate-700 border border-black/15 rounded-xl text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
            >
              <X className="w-3.5 h-3.5" />
              <span>ซ่อน</span>
            </button>
          </div>
        </div>

        {studentFullName.trim() || matchedStudent ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 space-y-3">
              <div>
                <span className="text-xs font-medium text-slate-600">ชื่อ-นามสกุลนักเรียนผู้รับ</span>
                <div className={`text-xl sm:text-2xl font-bold ${dormTheme.textClass}`}>
                  {studentFullName.trim() ||
                    `${matchedStudent?.prefix || ''}${matchedStudent?.firstName || ''} ${
                      matchedStudent?.lastName || ''
                    }`}{' '}
                  {(studentNickname.trim() || matchedStudent?.nickname) && (
                    <span className="font-normal text-base">
                      ({studentNickname.trim() || matchedStudent?.nickname})
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-600 mt-1 font-mono tabular-nums">
                  รหัสนักเรียน: {formatStudentCode(studentCodeInput.trim() || matchedStudent?.studentCode) || '-'} · ชั้น{' '}
                  {studentGradeRoom.trim() ||
                    (matchedStudent ? `${matchedStudent.grade}/${matchedStudent.room}` : '-')}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="bg-white/90 border border-black/10 rounded-xl p-3.5">
                  <span className="block text-xs font-medium text-slate-500">สีตะกร้าคัดแยก</span>
                  <span className={`block text-sm font-bold mt-1 ${dormTheme.textClass}`}>
                    {dormTheme.colorName}
                  </span>
                </div>
                <div className="bg-white/90 border border-black/10 rounded-xl p-3.5">
                  <span className="block text-xs font-medium text-slate-500">ห้องพักหอ</span>
                  <span className={`block text-2xl font-mono font-extrabold tabular-nums mt-0.5 ${dormTheme.textClass}`}>
                    {studentDormRoom.trim() || matchedStudent?.dormRoom || '-'}
                  </span>
                </div>
              </div>

              {/* แสดงจำนวนชิ้นรวมปัจจุบันบนการ์ดคัดแยกตะกร้า */}
              <div className="bg-white/90 border border-black/10 rounded-xl p-3.5 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700">
                  จำนวนชิ้นรวมปัจจุบัน
                </span>
                <span className={`text-lg font-mono font-extrabold tabular-nums ${dormTheme.textClass}`}>
                  {activeStudentParcelStats.totalCount} ชิ้น
                </span>
              </div>
            </div>

            {availableDormitories.length > 0 && (
              <div className="lg:col-span-7 bg-white/70 border border-black/10 rounded-xl p-4 space-y-2.5">
                <span className="block text-xs font-bold text-slate-700">
                  ผังสีตะกร้าประจำหอพักในระบบ:
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {availableDormitories.map((dName) => {
                    const t = getDormitoryTheme(dName);
                    const isCurrent = dName === activeDormitoryName;
                    return (
                      <div
                        key={dName}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-xs transition-colors ${
                          isCurrent
                            ? 'bg-white font-bold border-slate-900 ring-2 ring-slate-900/20 shadow-xs'
                            : 'bg-white/80 border-black/5 text-slate-700'
                        }`}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-sm shrink-0"
                          style={{ backgroundColor: t.hexColor }}
                        />
                        <span className="font-mono font-bold text-slate-900">{t.basketCode}</span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-700 truncate">{t.shortName}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-white/80 rounded-xl border border-black/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-800">
                  ผู้รับ: กรุณากรอกหรือป้อนรหัสนักเรียนในส่วน "กรอกข้อมูลนักเรียน และดึงข้อมูล"
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  เมื่อป้อนรหัสหรือเลือกนักเรียน ระบบจะแสดงชื่อ หอพัก ห้อง และเน้นสีตะกร้าคัดแยกที่นี่ทันที
                </p>
              </div>
            </div>

            {availableDormitories.length > 0 && (
              <div className="pt-1">
                <span className="block text-xs font-bold text-slate-700 mb-2">
                  ผังสีตะกร้าประจำหอพักในระบบ:
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
                  {availableDormitories.map((dName) => {
                    const t = getDormitoryTheme(dName);
                    return (
                      <div
                        key={dName}
                        className="flex items-center gap-2.5 bg-white/90 px-3 py-2 rounded-xl border border-black/10 text-xs shadow-2xs hover:bg-white transition-colors"
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-sm shrink-0 shadow-2xs"
                          style={{ backgroundColor: t.hexColor }}
                        />
                        <span className="font-mono font-bold text-slate-900">{t.basketCode}</span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-700 truncate">{t.shortName}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
      )}

      {/* รายการพัสดุที่รับเข้าล่าสุด - แสดงเมื่อกดปุ่มดูรายการพัสดุที่รับเข้าล่าสุด */}
      {isRecentParcelsOpen && (
      <section ref={recentParcelsSectionRef} data-section-id="recent" className="scroll-mt-28 bg-white border border-slate-200 rounded-2xl p-5 md:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-slate-600" />
                <span>รายการพัสดุที่รับเข้าล่าสุด</span>
              </h3>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-xs font-mono text-slate-500 tabular-nums">
                  แสดง {filteredRecentParcels.length} จาก {allFilteredRecentParcels.length} ชิ้น
                </span>
                <button
                  type="button"
                  onClick={handleScrollToScan}
                  title="เลื่อนกลับขึ้นไปด้านบนเพื่อสแกนโค้ดหรือกรอกเลขพัสดุ"
                  className="no-print min-h-[34px] px-3 py-1.5 bg-slate-900 hover:bg-slate-800 active:scale-98 text-white text-xs font-bold rounded-xl transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Barcode className="w-3.5 h-3.5 shrink-0" />
                  <span>กลับขึ้นไปสแกนโค้ด</span>
                  <ArrowUp className="w-3.5 h-3.5 shrink-0" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsRecentParcelsOpen(false)}
                  className="no-print min-h-[34px] px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>ซ่อน</span>
                </button>
              </div>
            </div>

            {/* กล่องรับวันที่สำหรับรายการพัสดุที่รับเข้าล่าสุด แสดงปฏิทินเป็นภาษาไทย */}
            <div className="flex flex-col gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              {/* บรรทัดที่ 1: กล่องข้อความ วันที่รับเข้า: แสดงปฏิทินเป็นภาษาไทย */}
              <div className="flex flex-wrap items-center gap-2 relative" ref={thaiCalendarRef}>
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 shrink-0">
                  <Calendar className="w-4 h-4 text-emerald-700 shrink-0" />
                  <label htmlFor="thai-calendar-trigger-btn">
                    วันที่รับเข้า:
                  </label>
                </div>

                {/* ปุ่มเปิดปฏิทินภาษาไทย */}
                <div className="relative">
                  <button
                    id="thai-calendar-trigger-btn"
                    type="button"
                    onClick={() => setIsThaiCalendarOpen((prev) => !prev)}
                    className="min-h-[40px] px-3.5 py-2 text-xs font-bold text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 hover:border-slate-400 rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-xs focus:ring-2 focus:ring-slate-900/20"
                    title="คลิกเพื่อเปิดปฏิทินภาษาไทย (พ.ศ.)"
                  >
                    <Calendar className="w-4 h-4 text-emerald-700" />
                    <span>{recentDateFilter ? formatThaiDisplayDate(recentDateFilter) : 'ทุกวัน (ยังไม่เลือกวันที่)'}</span>
                    {recentDateFilter === todayIsoStr && (
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                        (วันนี้)
                      </span>
                    )}
                    <ChevronDown className={`w-3.5 h-3.5 text-slate-500 ml-1 transition-transform ${isThaiCalendarOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Popover ปฏิทินภาษาไทย (พ.ศ.) */}
                  {isThaiCalendarOpen && (
                    <div className="absolute left-0 top-full mt-1.5 z-40 w-72 sm:w-80 bg-white rounded-2xl shadow-xl border border-slate-300 p-3.5 animate-in fade-in zoom-in-95 duration-150">
                      {/* ส่วนหัวปฏิทิน: สลับเดือน/ปี พ.ศ. */}
                      <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
                        <button
                          type="button"
                          onClick={handlePrevMonth}
                          aria-label="เดือนก่อนหน้า"
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="text-center">
                          <span className="font-bold text-sm text-slate-900">
                            {THAI_MONTH_NAMES_FULL[calendarViewMonth]}
                          </span>{' '}
                          <span className="font-bold text-sm text-emerald-800 font-mono">
                            พ.ศ. {calendarViewYear + 543}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={handleNextMonth}
                          aria-label="เดือนถัดไป"
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>

                      {/* ชื่อวันในสัปดาห์ (ภาษาไทย) */}
                      <div className="grid grid-cols-7 gap-1 text-center py-2 text-[11px] font-bold text-slate-500 border-b border-slate-100">
                        {THAI_DAY_HEADERS.map((day, idx) => (
                          <div key={day} className={idx === 0 ? 'text-red-600' : idx === 6 ? 'text-purple-600' : ''}>
                            {day}
                          </div>
                        ))}
                      </div>

                      {/* ตารางวันที่ในเดือน */}
                      <div className="grid grid-cols-7 gap-1 pt-2">
                        {thaiCalendarDays.map((d) => {
                          return (
                            <button
                              key={d.dateStr}
                              type="button"
                              onClick={() => handleSelectDateFromCalendar(d.dateStr)}
                              className={`h-8 sm:h-9 rounded-lg text-xs font-semibold flex items-center justify-center transition-all cursor-pointer ${
                                d.isSelected
                                  ? 'bg-slate-900 text-white font-bold shadow-xs ring-2 ring-slate-900/30'
                                  : d.isToday
                                  ? 'bg-emerald-50 text-emerald-900 border border-emerald-400 font-bold hover:bg-emerald-100'
                                  : d.isCurrentMonth
                                  ? 'text-slate-800 hover:bg-slate-100'
                                  : 'text-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              {d.dayNumber}
                            </button>
                          );
                        })}
                      </div>

                      {/* ปุ่มล่างปฏิทิน */}
                      <div className="pt-3 mt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                        <button
                          type="button"
                          onClick={() => handleSelectDateFromCalendar(todayIsoStr)}
                          className="font-bold text-emerald-700 hover:text-emerald-900 hover:underline cursor-pointer"
                        >
                          เลือกวันนี้
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRecentDateFilter('');
                            setRecentPage(1);
                            setIsThaiCalendarOpen(false);
                          }}
                          className="font-semibold text-slate-500 hover:text-slate-800 hover:underline cursor-pointer"
                        >
                          ล้างวันที่ (ทุกวัน)
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsThaiCalendarOpen(false)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg cursor-pointer"
                        >
                          ปิด
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {recentDateFilter && (
                  <button
                    type="button"
                    aria-label="ล้างวันที่ (แสดงทุกวัน)"
                    title="ล้างวันที่ (แสดงทุกวัน)"
                    onClick={() => {
                      setRecentDateFilter('');
                      setRecentPage(1);
                    }}
                    className="min-h-[38px] px-2.5 py-1 text-xs font-semibold text-slate-500 hover:text-red-700 bg-white hover:bg-red-50 border border-slate-300 rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">ล้างตัวกรอง</span>
                  </button>
                )}
              </div>

              {/* บรรทัดที่ 2: ให้ปุ่ม วันนี้ และ ปุ่มทุกวัน(125) อยู่คนละบรรทัดกับ ปฏิทิน */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/80">
                <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                  ตัวเลือกแสดงด่วน:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setRecentDateFilter(todayIsoStr);
                    setRecentPage(1);
                  }}
                  className={`min-h-[36px] px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    recentDateFilter === todayIsoStr
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 hover:border-slate-400'
                  }`}
                  title="ตั้งค่าเป็นวันที่ปัจจุบัน"
                >
                  <Calendar className="w-3.5 h-3.5 text-emerald-500" />
                  <span>วันนี้</span>
                  {recentDateFilter === todayIsoStr && <Check className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRecentDateFilter('');
                    setRecentPage(1);
                  }}
                  className={`min-h-[36px] px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    !recentDateFilter
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 hover:border-slate-400'
                  }`}
                  title="แสดงพัสดุทุกวันที่รับเข้า"
                >
                  <span>ทุกวัน ({parcels.length})</span>
                  {!recentDateFilter && <Check className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* ตัวเลือกแสดงตามหอพัก (Dropdown + ปุ่มกดเลือกหอพัก) */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="recent-dorm-filter-select"
                  className="text-xs font-bold text-slate-700 flex items-center gap-1.5"
                >
                  <Building2 className="w-3.5 h-3.5 text-slate-600" />
                  <span>เลือกแสดงเป็นหอพัก:</span>
                </label>

                <select
                  id="recent-dorm-filter-select"
                  value={recentDormFilter}
                  onChange={(e) => {
                    setRecentDormFilter(e.target.value);
                    setRecentPage(1);
                  }}
                  className="min-h-[38px] px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                >
                  <option value="ALL">ทุกหอพักรวม ({parcelsForDate.length} ชิ้น)</option>
                  {availableDormitories.map((dName) => (
                    <option key={dName} value={dName}>
                      {dName} ({getDormitoryTheme(dName).basketCode}) · {dormParcelCounts[dName] || 0} ชิ้น
                    </option>
                  ))}
                </select>
              </div>

              {/* แถบปุ่มกดกรองตามหอพักด่วน */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setRecentDormFilter('ALL');
                    setRecentPage(1);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    recentDormFilter === 'ALL'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  ทุกหอพัก ({parcelsForDate.length})
                </button>
                {availableDormitories.map((dName) => {
                  const active = recentDormFilter === dName;
                  const t = getDormitoryTheme(dName);
                  const count = dormParcelCounts[dName] || 0;
                  return (
                    <button
                      key={dName}
                      type="button"
                      onClick={() => {
                        setRecentDormFilter(dName);
                        setRecentPage(1);
                      }}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                        active
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: t.hexColor }}
                      />
                      <span>{dName}</span>
                      <span className="font-mono tabular-nums opacity-80">({count})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {filteredRecentParcels.length === 0 ? (
              <div className="py-8 text-center space-y-2 bg-slate-50 rounded-xl border border-dashed border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-700">
                  {recentDateFilter
                    ? `ยังไม่มีรายการพัสดุที่รับเข้าในวันที่ ${formatThaiSlashDate(recentDateFilter)}${
                        recentDormFilter !== 'ALL' ? ` สำหรับ "${recentDormFilter}"` : ''
                      }`
                    : recentDormFilter === 'ALL'
                    ? 'ยังไม่มีรายการพัสดุที่รับเข้า'
                    : `ยังไม่มีรายการพัสดุที่รับเข้าสำหรับ "${recentDormFilter}"`}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  {recentDateFilter && (
                    <button
                      type="button"
                      onClick={() => {
                        setRecentDateFilter('');
                        setRecentPage(1);
                      }}
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 underline cursor-pointer px-2 py-0.5"
                    >
                      ดูพัสดุทุกวันที่รับเข้า ({parcels.length} ชิ้น)
                    </button>
                  )}
                  {recentDormFilter !== 'ALL' && (
                    <button
                      type="button"
                      onClick={() => {
                        setRecentDormFilter('ALL');
                        setRecentPage(1);
                      }}
                      className="text-xs font-bold text-slate-700 hover:text-slate-900 underline cursor-pointer px-2 py-0.5"
                    >
                      กลับไปดูทุกหอพัก
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="divide-y divide-slate-100">
                  {filteredRecentParcels.map((p) => {
                    const pTheme = getDormitoryTheme(p.dormitory);
                    const pStats = !isUnknownOwnerParcel(p)
                      ? getStudentParcelCounts(p.studentCode, p.studentFullName)
                      : null;
                    const isLegalHold = p.status === 'ติดนิติการ';
                    const isMedicalHold = p.status === 'ติดต่องานพยาบาล';

                    return (
                      <div
                        key={p.id}
                        className={`rounded-xl transition-all flex flex-col gap-2 ${
                          isLegalHold
                            ? 'bg-red-50/90 border-2 border-red-300 p-3.5 my-2 shadow-xs'
                            : isMedicalHold
                            ? 'bg-amber-50/90 border-2 border-amber-300 p-3.5 my-2 shadow-xs'
                            : 'py-3.5 px-2 first:pt-1 last:pb-1 hover:bg-slate-50/80'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className="w-3 h-3 rounded-sm shrink-0"
                                style={{ backgroundColor: pTheme.hexColor }}
                              />
                              <span
                                style={isRedHighlightTrackingNumber(p.trackingNumber, p) ? { color: '#DC2626' } : undefined}
                                className={`font-mono font-bold text-sm tabular-nums ${
                                  isRedHighlightTrackingNumber(p.trackingNumber, p)
                                    ? 'text-red-600 font-extrabold'
                                    : 'text-slate-900'
                                }`}
                              >
                                {p.trackingNumber}
                              </span>
                              <span className="text-slate-300">·</span>
                              <span className="text-xs font-semibold text-slate-700">
                                {pTheme.basketCode} ({p.dormitory} ห้อง {p.dormRoom})
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-xs">
                              <span className="inline-flex items-center gap-1 font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                                <Calendar className="w-3 h-3 text-slate-500 shrink-0" />
                                <span>รับเข้า: {formatThaiSlashDate(p.receivedDate || extractParcelLocalYMD(p))}</span>
                                {p.createdAt && (
                                  <span className="text-slate-500 font-mono text-[10.5px]">
                                    ({new Date(p.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.)
                                  </span>
                                )}
                              </span>
                              <span className="text-slate-300">·</span>
                              <span className="text-xs text-slate-600 font-medium">ขนส่ง: {p.courier || '-'}</span>
                              {p.recordedByName && (
                                <>
                                  <span className="text-slate-300">·</span>
                                  <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                                    ผู้รับเข้า: {p.recordedByName}
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="text-xs text-slate-600 mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-slate-800">{p.studentFullName}</span>
                              <span className="text-slate-300">·</span>
                              <span className="font-mono">รหัส {formatStudentCode(p.studentCode)}</span>
                              <span className="text-slate-300">·</span>
                              <span className="font-medium text-slate-800">{p.category}</span>
                              <span className="text-slate-300">·</span>
                              {isLegalHold ? (
                                <span className="font-bold text-xs text-white bg-red-600 px-2 py-0.5 rounded shadow-xs inline-flex items-center gap-1">
                                  <span>พัสดุติดนิติการ{p.note && p.note.trim() && p.note !== 'ส่งตรวจห้องนิติการ/ครูหอพักตามระเบียบ' ? `: ${p.note.trim()}` : ''}</span>
                                </span>
                              ) : isMedicalHold ? (
                                <span className="font-bold text-xs text-slate-950 bg-amber-400 px-2 py-0.5 rounded shadow-xs inline-flex items-center gap-1">
                                  <span>ติดต่องานพยาบาล</span>
                                </span>
                              ) : p.status === 'พัสดุไม่ทราบเจ้าของ' ? (
                                <span className="font-bold text-slate-600">
                                  สถานะ: {p.status}
                                </span>
                              ) : (
                                <span className="font-bold text-emerald-700">
                                  สถานะ: {p.status}
                                </span>
                              )}
                            </div>
                            {p.note && p.note.trim() && p.note !== 'ส่งตรวจห้องนิติการ/ครูหอพักตามระเบียบ' && isLegalHold && (
                              <div className="text-xs font-semibold px-2.5 py-1 rounded-lg mt-1 border bg-red-100/90 text-red-950 border-red-200">
                                สาเหตุติดนิติการ: {p.note.trim()}
                              </div>
                            )}
                            {p.note && p.note !== 'ส่งตรวจห้องนิติการ/ครูหอพักตามระเบียบ' && p.note !== 'ส่งต่องานพยาบาล' && isMedicalHold && (
                              <div className="text-xs font-medium px-2.5 py-1 rounded-lg mt-1 border bg-amber-100/90 text-amber-950 border-amber-200">
                                หมายเหตุ: {p.note}
                              </div>
                            )}
                            {pStats && (
                              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 mt-1 font-mono tabular-nums">
                                <span>
                                  จำนวนพัสดุ: วัน <strong>{pStats.dayCount}</strong> · สัปดาห์{' '}
                                  <strong
                                    className={
                                      pStats.isOverWeeklyLimit ? 'text-red-600' : 'text-slate-900'
                                    }
                                  >
                                    {pStats.weekCount}
                                  </strong>{' '}
                                  · เดือน <strong>{pStats.monthCount}</strong> ชิ้น
                                </span>
                                {pStats.isOverWeeklyLimit && (
                                  <button
                                    type="button"
                                    onClick={() => openWeeklyWarningPopup(pStats, 'manual')}
                                    className="font-sans px-2 py-0.5 bg-red-100 hover:bg-red-200 text-red-800 font-bold rounded-md cursor-pointer"
                                  >
                                    เกิน 3 ชิ้น/สัปดาห์
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 shrink-0">
                            {(() => {
                              const isReceivedToday = extractParcelLocalYMD(p) === todayIsoStr || p.receivedDate === todayIsoStr;
                              const isStaffOrAdmin =
                                currentMember?.role === 'ผู้ดูแลระบบ' ||
                                currentMember?.role === 'เจ้าหน้าที่';
                              const canEditThisParcel = isStaffOrAdmin || isReceivedToday;

                              return (
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditModal(p)}
                                  disabled={!canEditThisParcel}
                                  title={
                                    canEditThisParcel
                                      ? 'แก้ไขการรับพัสดุ (แก้ไขข้อมูลผู้รับพัสดุ, สถานะพัสดุ)'
                                      : 'แก้ไขได้เฉพาะพัสดุที่รับเข้าเฉพาะวันนี้เท่านั้น (เจ้าหน้าที่/ผู้ดูแล แก้ไขได้ตลอด)'
                                  }
                                  className={`min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                                    canEditThisParcel
                                      ? 'bg-blue-50 hover:bg-blue-600 hover:text-white text-blue-800 border border-blue-200 cursor-pointer shadow-2xs'
                                      : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-60'
                                  }`}
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  <span>แก้ไขการรับพัสดุ</span>
                                </button>
                              );
                            })()}

                            {p.status !== 'ส่งมอบสำเร็จ' && (
                              <button
                                type="button"
                                onClick={() => handleOpenDeliveryModal(p)}
                                className="min-h-[38px] px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-800 rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer"
                              >
                                <span>เซ็นรับสำเร็จ</span>
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ตัวแบ่งหน้า (Pagination Controls) */}
                <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
                  <div>
                    <select
                      id="recent-page-size-select"
                      aria-label="จำนวนชิ้นต่อหน้า"
                      value={recentPageSize}
                      onChange={(e) => {
                        setRecentPageSize(e.target.value);
                        setRecentPage(1);
                      }}
                      className="min-h-[34px] px-2.5 py-1 text-xs font-mono font-semibold bg-slate-50 border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-slate-900"
                    >
                      <option value="10">10</option>
                      <option value="20">20</option>
                      <option value="30">30</option>
                      <option value="50">50</option>
                      <option value="ALL">All</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={currentRecentPage <= 1}
                      onClick={() => setRecentPage(Math.max(1, currentRecentPage - 1))}
                      aria-label="หน้าก่อนหน้า"
                      className="min-h-[34px] px-3 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>ก่อนหน้า</span>
                    </button>

                    <button
                      type="button"
                      disabled={currentRecentPage >= totalRecentPages}
                      onClick={() => setRecentPage(Math.min(totalRecentPages, currentRecentPage + 1))}
                      aria-label="หน้าถัดไป"
                      className="min-h-[34px] px-3 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <span>ถัดไป</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
      )}

      {/* Modal เลือกวันที่รับพัสดุ */}
      <DeliveryDateModal
        isOpen={isDeliveryModalOpen}
        onClose={() => {
          setIsDeliveryModalOpen(false);
          setDeliveryModalParcel(null);
        }}
        parcel={deliveryModalParcel}
        onConfirm={handleConfirmDelivery}
      />

      {/* Modal แก้ไขการรับพัสดุ (แก้ไขข้อมูลผู้รับพัสดุ, สถานะพัสดุ) */}
      <EditInboundParcelModal
        isOpen={isEditModalOpen}
        parcel={editingParcel}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingParcel(null);
        }}
      />

      {/* Popup แจ้งเตือนเลขพัสดุซ้ำ "เลขพัสดุได้ถูกใช้งานแล้ว" พร้อมแสดงข้อมูลที่ผูกกับเลขพัสดุชิ้นนั้น */}
      <DuplicateParcelModal
        isOpen={isDuplicateModalOpen}
        parcel={duplicateParcel || detectedDuplicateParcel}
        onClose={() => {
          setIsDuplicateModalOpen(false);
          const currentItem = duplicateParcel || detectedDuplicateParcel;
          if (currentItem) {
            dismissedDuplicateTrackingRef.current = `${currentItem.id || ''}_${currentItem.trackingNumber || ''}`.toUpperCase();
          }
        }}
        onClearTracking={() => {
          setTrackingNumber('');
          setSixDigitsInput('');
          setLastScannedCode(null);
          dismissedDuplicateTrackingRef.current = '';
          setDuplicateParcel(null);
          setIsDuplicateModalOpen(false);
          if (trackingInputMode === 'six_digits' && courier !== 'ผู้ปกครองฝากส่ง') {
            sixDigitsInputRef.current?.focus();
          } else {
            trackingInputRef.current?.focus();
          }
        }}
        onOpenEdit={(p) => {
          setIsDuplicateModalOpen(false);
          handleOpenEditModal(p);
        }}
        canEdit={(() => {
          const target = duplicateParcel || detectedDuplicateParcel;
          if (!target) return false;
          const isReceivedToday =
            extractParcelLocalYMD(target) === todayIsoStr ||
            target.receivedDate === todayIsoStr;
          const isStaffOrAdmin =
            currentMember?.role === 'ผู้ดูแลระบบ' ||
            currentMember?.role === 'เจ้าหน้าที่';
          return isStaffOrAdmin || isReceivedToday;
        })()}
      />
      {/* ปุ่มลูกศร ขึ้น / ลง มุมขวาล่างสำหรับเลื่อนไป-กลับระหว่างหัวข้อการลงทะเบียนพัสดุ (ไม่ทับเมนูหลักและโปร่งใสมองเห็นชัด) */}
      <div
        role="navigation"
        aria-label="ปุ่มลูกศรเลื่อนขึ้นลงระหว่างหัวข้อการลงทะเบียนพัสดุ"
        className="no-print fixed right-3.5 sm:right-5 bottom-20 lg:right-6 lg:bottom-6 z-30 flex flex-col gap-2"
      >
        <button
          type="button"
          onClick={() => handleStepSection('prev')}
          disabled={activeSectionId === inboundSections[0].id && !isScrolledDown}
          aria-label="เลื่อนขึ้นหัวข้อก่อนหน้า"
          title="เลื่อนขึ้นหัวข้อก่อนหน้า"
          className="w-11 h-11 rounded-full bg-slate-900/55 hover:bg-slate-900/80 active:scale-95 disabled:opacity-30 disabled:pointer-events-none text-white backdrop-blur-md border border-white/35 shadow-lg ring-1 ring-slate-900/15 flex items-center justify-center transition-all cursor-pointer"
        >
          <ArrowUp className="w-5 h-5 stroke-[2.5]" />
        </button>

        <button
          type="button"
          onClick={() => handleStepSection('next')}
          disabled={activeSectionId === inboundSections[inboundSections.length - 1].id}
          aria-label="เลื่อนลงหัวข้อถัดไป"
          title="เลื่อนลงหัวข้อถัดไป"
          className="w-11 h-11 rounded-full bg-slate-900/55 hover:bg-slate-900/80 active:scale-95 disabled:opacity-30 disabled:pointer-events-none text-white backdrop-blur-md border border-white/35 shadow-lg ring-1 ring-slate-900/15 flex items-center justify-center transition-all cursor-pointer"
        >
          <ArrowDown className="w-5 h-5 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
};
