import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Printer,
  X,
  ZoomIn,
  ZoomOut,
  Building2,
} from 'lucide-react';
import {
  Parcel,
  DormitoryTheme,
  getDormitoryTheme,
  compareDormitoryNatural,
  formatThaiSlashDate,
  formatStudentCode,
  formatParcelRegistrationDateTime,
  isGreenHighlightTrackingNumber,
  buildStudentParcelSummaryMap,
} from '../types/parcel';

export type PrintOrientation = 'portrait' | 'landscape';
export type RowDensity = 'normal' | 'compact';

interface ManifestPrintPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  parcels: Parcel[];
  allStatusFilteredParcels?: Parcel[];
  allParcels?: Parcel[];
  availableDormitories?: string[];
  dormitory: string;
  activeTheme: DormitoryTheme;
  printDateDisplay: string;
  selectedStatusLabel: string;
  selectedDate?: string;
  selectedSortLabel?: string;
}

interface ManifestPrintGroup {
  key: string;
  dormitory: string;
  theme: DormitoryTheme;
  parcels: Parcel[];
}

interface PageChunk {
  parcels: Parcel[];
  startIndex: number;
}

const SEPARATE_BY_DORM_VALUE = 'SEPARATE_BY_DORM';

// A4 printable area at 96dpi minus 6mm margins on each side and safety buffer:
// Portrait: 210mm x 297mm -> 198mm x 274mm (~748px x 1030px usable)
// Landscape: 297mm x 210mm -> 285mm x 188mm (~1077px x 706px usable)
const PRINT_WIDTH_PX_PORTRAIT = 748;
const PRINT_WIDTH_PX_LANDSCAPE = 1077;
const PRINT_HEIGHT_PX_PORTRAIT = 1030;
const PRINT_HEIGHT_PX_LANDSCAPE = 706;

function buildFallbackChunks(parcels: Parcel[], perPage: number): PageChunk[] {
  if (parcels.length === 0) {
    return [{ parcels: [], startIndex: 0 }];
  }
  const chunks: PageChunk[] = [];
  for (let i = 0; i < parcels.length; i += perPage) {
    chunks.push({
      parcels: parcels.slice(i, i + perPage),
      startIndex: i,
    });
  }
  return chunks;
}

export const ManifestPrintPreviewModal: React.FC<ManifestPrintPreviewModalProps> = ({
  isOpen,
  onClose,
  parcels,
  allStatusFilteredParcels,
  allParcels,
  availableDormitories,
  dormitory,
  printDateDisplay,
  selectedStatusLabel,
  selectedDate,
  selectedSortLabel,
}) => {
  const [orientation, setOrientation] = useState<PrintOrientation>('portrait');
  const [density, setDensity] = useState<RowDensity>('compact');
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [printDormitory, setPrintDormitory] = useState<string>(dormitory || 'ALL');
  const [measuredChunksByGroup, setMeasuredChunksByGroup] = useState<Record<string, PageChunk[]>>({});

  const measureRootRef = useRef<HTMLDivElement | null>(null);

  // ซิงค์ค่าหอพักเริ่มต้นเมื่อเปิดหน้าต่างตัวอย่างการพิมพ์
  useEffect(() => {
    if (isOpen) {
      setPrintDormitory(dormitory || 'ALL');
    }
  }, [isOpen, dormitory]);

  const sourceParcels = useMemo(() => {
    return allStatusFilteredParcels ?? parcels;
  }, [allStatusFilteredParcels, parcels]);

  // รายชื่อหอพักทั้งหมดที่มีในข้อมูลและจากรายการที่ส่งเข้ามา
  const dormitoryOptions = useMemo(() => {
    const set = new Set<string>(availableDormitories || []);
    for (const p of sourceParcels) {
      const d = (p.dormitory || '').trim();
      if (d && d !== '-') {
        set.add(d);
      }
    }
    if (dormitory && dormitory !== 'ALL' && dormitory !== SEPARATE_BY_DORM_VALUE) {
      set.add(dormitory.trim());
    }
    return Array.from(set).sort(compareDormitoryNatural);
  }, [availableDormitories, sourceParcels, dormitory]);

  const dormCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of sourceParcels) {
      const d = (p.dormitory || '').trim() || 'ยังไม่ระบุหอพัก';
      map.set(d, (map.get(d) || 0) + 1);
    }
    return map;
  }, [sourceParcels]);

  const studentParcelSummaryMap = useMemo(() => {
    return buildStudentParcelSummaryMap(allParcels || sourceParcels, selectedDate);
  }, [allParcels, sourceParcels, selectedDate]);

  // จัดกลุ่มรายการพิมพ์ตามตัวเลือก "เลือกพิมพ์หอพัก"
  const manifestGroups = useMemo<ManifestPrintGroup[]>(() => {
    if (printDormitory === 'ALL') {
      return [
        {
          key: 'ALL',
          dormitory: 'ALL',
          theme: getDormitoryTheme('ทุกหอพักรวม'),
          parcels: sourceParcels,
        },
      ];
    }

    if (printDormitory === SEPARATE_BY_DORM_VALUE) {
      const grouped = new Map<string, Parcel[]>();
      for (const p of sourceParcels) {
        const d = (p.dormitory || '').trim() || 'ยังไม่ระบุหอพัก';
        const list = grouped.get(d);
        if (list) {
          list.push(p);
        } else {
          grouped.set(d, [p]);
        }
      }

      if (grouped.size === 0) {
        return [
          {
            key: 'EMPTY',
            dormitory: 'ALL',
            theme: getDormitoryTheme('ทุกหอพักรวม'),
            parcels: [],
          },
        ];
      }

      const sortedKeys = Array.from(grouped.keys()).sort((a, b) => {
        if (a === 'ยังไม่ระบุหอพัก') return 1;
        if (b === 'ยังไม่ระบุหอพัก') return -1;
        return compareDormitoryNatural(a, b);
      });

      return sortedKeys.map((dormName) => ({
        key: `DORM::${dormName}`,
        dormitory: dormName,
        theme: getDormitoryTheme(dormName === 'ยังไม่ระบุหอพัก' ? '' : dormName),
        parcels: grouped.get(dormName) || [],
      }));
    }

    const targetDorm = printDormitory.trim();
    const filtered = sourceParcels.filter(
      (p) => ((p.dormitory || '').trim() || 'ยังไม่ระบุหอพัก') === targetDorm
    );
    return [
      {
        key: `SINGLE::${targetDorm}`,
        dormitory: targetDorm,
        theme: getDormitoryTheme(targetDorm === 'ยังไม่ระบุหอพัก' ? '' : targetDorm),
        parcels: filtered,
      },
    ];
  }, [printDormitory, sourceParcels]);

  const isLandscape = orientation === 'landscape';

  // คำนวณการแบ่งหน้าอัตโนมัติตามความสูงจริงของแต่ละแถวใน A4 เพื่อไม่ให้ล้นหน้าและพิมพ์ซ้ำหัวกระดาษได้ครบทุกหน้า
  useLayoutEffect(() => {
    if (!isOpen) return;
    const root = measureRootRef.current;
    if (!root) return;

    const printableHeight = isLandscape ? PRINT_HEIGHT_PX_LANDSCAPE : PRINT_HEIGHT_PX_PORTRAIT;
    const topBarEl = root.querySelector('[data-measure="top-bar"]') as HTMLElement | null;
    const theadEl = root.querySelector('[data-measure="thead"]') as HTMLElement | null;
    const footerEl = root.querySelector('[data-measure="footer"]') as HTMLElement | null;

    const topBarHeight = topBarEl ? topBarEl.getBoundingClientRect().height + 4 : 22;
    const theadHeight = theadEl ? theadEl.getBoundingClientRect().height : 32;
    const footerHeight = footerEl ? footerEl.getBoundingClientRect().height + 10 : 48;

    const nextMap: Record<string, PageChunk[]> = {};

    for (const group of manifestGroups) {
      const headerEl = root.querySelector(
        `[data-measure-header="${CSS.escape(group.key)}"]`
      ) as HTMLElement | null;
      const headerHeight = headerEl ? headerEl.getBoundingClientRect().height + 8 : 66;

      // เว้นระยะเผื่อ 22px ป้องกันเส้นขอบหรือการปัดเศษของเบราว์เซอร์ดันขึ้นหน้าใหม่โดยไม่ตั้งใจ
      const availableBodyHeight = Math.max(
        140,
        printableHeight - topBarHeight - headerHeight - theadHeight - footerHeight - 22
      );

      if (group.parcels.length === 0) {
        nextMap[group.key] = [{ parcels: [], startIndex: 0 }];
        continue;
      }

      const chunks: PageChunk[] = [];
      let currentParcels: Parcel[] = [];
      let currentStartIndex = 0;
      let currentHeight = 0;

      group.parcels.forEach((p, idx) => {
        const rowKey = `${group.key}::${p.id}::${idx}`;
        const rowEl = root.querySelector(
          `[data-measure-row="${CSS.escape(rowKey)}"]`
        ) as HTMLElement | null;
        const rowHeight = rowEl
          ? rowEl.getBoundingClientRect().height
          : density === 'compact'
          ? 30
          : 38;

        if (currentParcels.length > 0 && currentHeight + rowHeight > availableBodyHeight) {
          chunks.push({
            parcels: currentParcels,
            startIndex: currentStartIndex,
          });
          currentParcels = [p];
          currentStartIndex = idx;
          currentHeight = rowHeight;
        } else {
          currentParcels.push(p);
          currentHeight += rowHeight;
        }
      });

      if (currentParcels.length > 0) {
        chunks.push({
          parcels: currentParcels,
          startIndex: currentStartIndex,
        });
      }

      nextMap[group.key] = chunks;
    }

    setMeasuredChunksByGroup((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(nextMap);
      if (prevKeys.length === nextKeys.length) {
        let same = true;
        for (const k of nextKeys) {
          const a = prev[k];
          const b = nextMap[k];
          if (!a || !b || a.length !== b.length) {
            same = false;
            break;
          }
          for (let i = 0; i < a.length; i++) {
            if (
              a[i].startIndex !== b[i].startIndex ||
              a[i].parcels.length !== b[i].parcels.length
            ) {
              same = false;
              break;
            }
          }
          if (!same) break;
        }
        if (same) return prev;
      }
      return nextMap;
    });
  }, [isOpen, orientation, density, manifestGroups, isLandscape, studentParcelSummaryMap]);

  // ปิดด้วยปุ่ม Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // ล็อค scroll ของ body เมื่อเปิด modal
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const fallbackPerPage = isLandscape
    ? density === 'compact'
      ? 16
      : 13
    : density === 'compact'
    ? 25
    : 20;

  const resolvedPages = manifestGroups.flatMap((group) => {
    const chunks =
      measuredChunksByGroup[group.key] ||
      buildFallbackChunks(group.parcels, fallbackPerPage);
    const totalPagesInGroup = chunks.length;
    return chunks.map((chunk, pageIndexInGroup) => ({
      group,
      chunk,
      pageNumber: pageIndexInGroup + 1,
      totalPages: totalPagesInGroup,
      pageKey: `${group.key}::page-${pageIndexInGroup + 1}`,
    }));
  });

  const totalDisplayedParcels = manifestGroups.reduce((sum, g) => sum + g.parcels.length, 0);
  const totalPagesCount = resolvedPages.length;

  const currentDormSummaryText =
    printDormitory === 'ALL'
      ? 'ทุกหอพักรวมกัน'
      : printDormitory === SEPARATE_BY_DORM_VALUE
      ? `พิมพ์แยกทีละหอพัก (${manifestGroups.length} หอ)`
      : `${getDormitoryTheme(printDormitory).name} (${getDormitoryTheme(printDormitory).basketCode})`;

  const handlePrint = () => {
    window.print();
  };

  // Helper แสดงตาราง (ใช้ร่วมกันทั้งหน้าจริงและตัววัดความสูง)
  const renderTableHeader = () =>
    isLandscape ? (
      <thead
        data-measure="thead"
        className="table-header-group border-y-2 border-slate-900 bg-slate-100 text-slate-900 font-bold text-[10.5px]"
      >
        <tr className="border-y-2 border-slate-900 bg-slate-100">
          <th className="py-2 px-1 border border-slate-400 text-center align-middle w-[4%] bg-slate-100 font-bold text-slate-900">ลำดับ</th>
          <th className="py-2 px-2 border border-slate-400 text-center align-middle w-[18%] bg-slate-100 font-bold text-slate-900">เลขพัสดุ (Tracking)</th>
          <th className="py-2 px-2 border border-slate-400 text-center align-middle w-[11%] bg-slate-100 font-bold text-slate-900">ขนส่ง</th>
          <th className="py-2 px-1 border border-slate-400 text-center align-middle w-[9%] bg-slate-100 font-bold text-slate-900">รหัส นร.</th>
          <th className="py-2 px-2 border border-slate-400 text-center align-middle w-[20%] bg-slate-100 font-bold text-slate-900">
            ชื่อ-นามสกุลนักเรียน
          </th>
          <th className="py-2 px-2 border border-slate-400 text-center align-middle w-[19%] bg-slate-100 font-bold text-slate-900">ประเภทสิ่งของ</th>
          <th className="py-2 px-1.5 border border-slate-400 text-center align-middle w-[12%] bg-slate-100 font-bold text-slate-900">
            ลายมือชื่อผู้รับ
          </th>
          <th className="py-2 px-1.5 border border-slate-400 text-center align-middle w-[7%] bg-slate-100 font-bold text-slate-900">
            วันที่รับ
          </th>
        </tr>
      </thead>
    ) : (
      <thead
        data-measure="thead"
        className="table-header-group border-y-2 border-slate-900 bg-slate-100 text-slate-900 font-bold text-[10px]"
      >
        <tr className="border-y-2 border-slate-900 bg-slate-100">
          <th className="py-2 px-1 border border-slate-400 text-center align-middle w-[5%] bg-slate-100 font-bold text-slate-900">ลำดับ</th>
          <th className="py-2 px-2 border border-slate-400 text-center align-middle w-[16%] bg-slate-100 font-bold text-slate-900">เลขพัสดุ / ขนส่ง</th>
          <th className="py-2 px-1 border border-slate-400 text-center align-middle w-[9%] bg-slate-100 font-bold text-slate-900">รหัส นร.</th>
          <th className="py-2 px-2 border border-slate-400 text-center align-middle w-[21%] bg-slate-100 font-bold text-slate-900">
            ชื่อ-นามสกุลนักเรียน
          </th>
          <th className="py-2 px-2 border border-slate-400 text-center align-middle w-[27%] bg-slate-100 font-bold text-slate-900">ประเภทสิ่งของ</th>
          <th className="py-2 px-1 border border-slate-400 text-center align-middle w-[12%] bg-slate-100 font-bold text-slate-900">
            ลายมือชื่อผู้รับ
          </th>
          <th className="py-2 px-1 border border-slate-400 text-center align-middle w-[10%] bg-slate-100 font-bold text-slate-900">
            วันที่รับ
          </th>
        </tr>
      </thead>
    );

  const renderParcelRow = (
    p: Parcel,
    displaySeq: number,
    keyStr: string,
    measureRowAttr?: string
  ) => {
    const isSigned = p.status === 'ส่งมอบสำเร็จ';
    const isLegalHold = p.status === 'ติดนิติการ';
    const isInfirmary = p.status === 'ติดต่องานพยาบาล';
    const isGreenTracking = isGreenHighlightTrackingNumber(p.trackingNumber, p);
    const isRdCategory = Boolean(p.category?.trim().toUpperCase().endsWith('-RD'));
    const cellPy = density === 'compact' ? 'py-1' : 'py-1.5';
    const recordedDate = isSigned
      ? formatThaiSlashDate(p.deliveredDate || p.receivedDate || p.updatedAt)
      : '';

    const rowStyle = isLegalHold
      ? { backgroundColor: '#FEF1F0', WebkitPrintColorAdjust: 'exact' as const, printColorAdjust: 'exact' as const }
      : isInfirmary
      ? { backgroundColor: '#FFFBEB', WebkitPrintColorAdjust: 'exact' as const, printColorAdjust: 'exact' as const }
      : undefined;

    const rowClass = `border-b break-inside-avoid ${
      isLegalHold
        ? 'bg-[#FEF1F0] text-rose-950 font-medium border-rose-300 print-highlight-legal print:bg-[#FEF1F0]'
        : isInfirmary
        ? 'bg-amber-50/70 text-amber-950 font-medium border-amber-300 print-highlight-infirmary print:bg-[#FFFBEB]'
        : 'bg-white border-slate-300'
    }`;

    if (isLandscape) {
      return (
        <tr key={keyStr} data-measure-row={measureRowAttr} style={rowStyle} className={rowClass}>
          <td className={`${cellPy} px-1 border border-slate-300 text-center font-mono font-semibold tabular-nums text-slate-700`}>
            {displaySeq}
          </td>
          <td className={`${cellPy} px-2 border border-slate-300 font-mono font-bold tabular-nums truncate`}>
            <div
              style={{
                color: isLegalHold ? '#DC2626' : isGreenTracking ? '#166534' : '#000000',
                WebkitPrintColorAdjust: 'exact',
                printColorAdjust: 'exact',
              }}
              className={`font-mono font-bold tabular-nums truncate font-extrabold ${
                isLegalHold
                  ? 'text-red-600 font-black print-legal-tracking'
                  : isGreenTracking
                  ? 'text-emerald-800 font-black print-green-tracking'
                  : 'text-slate-900 print-black-tracking'
              }`}
            >
              {p.trackingNumber}
            </div>
          </td>
          <td className={`${cellPy} px-2 border border-slate-300 text-slate-700 truncate`}>
            {p.courier}
          </td>
          <td className={`${cellPy} px-1 border border-slate-300 text-center font-mono font-semibold text-slate-900 tabular-nums`}>
            {formatStudentCode(p.studentCode)}
          </td>
          <td className={`${cellPy} px-2 border border-slate-300 leading-tight`}>
            <div className="font-bold text-slate-900 truncate">
              <span>{p.studentFullName}</span>
              {p.nickname && <span className="text-slate-600 font-normal ml-1">({p.nickname})</span>}
              {p.gradeRoom && <span className="text-slate-500 font-normal text-[10px] ml-1.5">ชั้น {p.gradeRoom}</span>}
            </div>
            {studentParcelSummaryMap.get(p.id) && (
              <div
                style={{ color: '#166534', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                className="text-[8.5px] font-mono text-emerald-800 font-semibold leading-tight mt-0.5 truncate print-student-parcel-summary"
              >
                {studentParcelSummaryMap.get(p.id)!.displayText}
              </div>
            )}
          </td>
          <td className={`${cellPy} px-2 border border-slate-300 leading-tight`}>
            <div
              style={isRdCategory ? { color: '#DC2626', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } : undefined}
              className={`font-semibold truncate ${
                isRdCategory ? 'text-red-600 print-rd-category font-bold' : 'text-slate-800'
              }`}
            >
              {p.category}
            </div>
            <div className="text-[9px] sm:text-[9.5px] leading-tight mt-0.5">
              <span
                style={{ color: '#166534', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                className="font-bold text-emerald-800 print-reg-date-time font-mono"
              >
                {formatParcelRegistrationDateTime(p)}
              </span>
              {isLegalHold && (
                <span
                  style={{ color: '#DC2626', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                  className="font-bold text-red-700 print-legal-tag ml-1"
                >
                  [ติดนิติการ{p.note && p.note.trim() && p.note !== 'ส่งตรวจห้องนิติการ/ครูหอพักตามระเบียบ' ? `: ${p.note.trim()}` : ''}]
                </span>
              )}
              {isInfirmary && (
                <span className="font-bold text-amber-800 ml-1">
                  [ติดต่องานพยาบาล]
                </span>
              )}
            </div>
          </td>
          <td className={`${cellPy} px-1 border border-slate-300 text-center`}>
            {isSigned ? (
              <div className="text-emerald-700 font-bold text-[9.5px] text-center leading-tight">
                เซ็นรับแล้ว
              </div>
            ) : (
              <div className="w-16 mx-auto pt-2.5 border-b border-dotted border-slate-400 text-[8px] text-slate-400 text-center">
                ลงชื่อ
              </div>
            )}
          </td>
          <td className={`${cellPy} px-1 border border-slate-300 text-center`}>
            {isSigned ? (
              <div className="text-emerald-700 font-bold text-[9.5px] text-center leading-tight">
                {recordedDate}
              </div>
            ) : (
              <div className="w-12 mx-auto pt-2.5 border-b border-dotted border-slate-400 text-[8px] text-slate-400 text-center">
                ว/ด/ป
              </div>
            )}
          </td>
        </tr>
      );
    }

    return (
      <tr key={keyStr} data-measure-row={measureRowAttr} style={rowStyle} className={rowClass}>
        <td className={`${cellPy} px-1 border border-slate-300 text-center font-mono font-semibold tabular-nums text-slate-700`}>
          {displaySeq}
        </td>
        <td className={`${cellPy} px-2 border border-slate-300 leading-tight`}>
          <div
            style={{
              color: isLegalHold ? '#DC2626' : isGreenTracking ? '#166534' : '#000000',
              WebkitPrintColorAdjust: 'exact',
              printColorAdjust: 'exact',
            }}
            className={`font-mono font-bold tabular-nums truncate font-extrabold ${
              isLegalHold
                ? 'text-red-600 font-black print-legal-tracking'
                : isGreenTracking
                ? 'text-emerald-800 font-black print-green-tracking'
                : 'text-slate-900 print-black-tracking'
            }`}
          >
            {p.trackingNumber}
          </div>
          <div className="text-[9px] text-slate-500 truncate">{p.courier}</div>
        </td>
        <td className={`${cellPy} px-1 border border-slate-300 text-center font-mono font-semibold text-slate-900 tabular-nums`}>
          {formatStudentCode(p.studentCode)}
        </td>
        <td className={`${cellPy} px-2 border border-slate-300 leading-tight`} title={`${p.studentFullName} ${p.nickname ? `(${p.nickname})` : ''} ชั้น ${p.gradeRoom}`}>
          <div className="font-bold text-slate-900 truncate">
            <span>{p.studentFullName}</span>
            {p.nickname && <span className="text-slate-600 font-normal ml-1">({p.nickname})</span>}
            {p.gradeRoom && <span className="text-slate-500 font-normal text-[9.5px] ml-1">ชั้น {p.gradeRoom}</span>}
          </div>
          {studentParcelSummaryMap.get(p.id) && (
            <div
              style={{ color: '#166534', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              className="text-[8px] sm:text-[8.5px] font-mono text-emerald-800 font-semibold leading-tight mt-0.5 truncate print-student-parcel-summary"
            >
              {studentParcelSummaryMap.get(p.id)!.displayText}
            </div>
          )}
        </td>
        <td className={`${cellPy} px-2 border border-slate-300 leading-tight`}>
          <div
            style={isRdCategory ? { color: '#DC2626', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } : undefined}
            className={`font-semibold truncate ${
              isRdCategory ? 'text-red-600 print-rd-category font-bold' : 'text-slate-800'
            }`}
          >
            {p.category}
          </div>
          <div className="text-[8.5px] sm:text-[9.5px] leading-tight mt-0.5">
            <span
              style={{ color: '#166534', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              className="font-bold text-emerald-800 print-reg-date-time font-mono"
            >
              {formatParcelRegistrationDateTime(p)}
            </span>
            {isLegalHold && (
              <span
                style={{ color: '#DC2626', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                className="font-bold text-red-700 print-legal-tag ml-1"
              >
                [ติดนิติการ{p.note && p.note.trim() && p.note !== 'ส่งตรวจห้องนิติการ/ครูหอพักตามระเบียบ' ? `: ${p.note.trim()}` : ''}]
              </span>
            )}
            {isInfirmary && (
              <span className="font-bold text-amber-800 ml-1">
                [ติดต่องานพยาบาล]
              </span>
            )}
          </div>
        </td>
        <td className={`${cellPy} px-1 border border-slate-300 text-center`}>
          {isSigned ? (
            <div className="text-emerald-700 font-bold text-[9.5px] text-center leading-tight">
              เซ็นรับแล้ว
            </div>
          ) : (
            <div className="w-16 mx-auto pt-2 border-b border-dotted border-slate-400 text-[8px] text-slate-400 text-center">
              ลงชื่อ
            </div>
          )}
        </td>
        <td className={`${cellPy} px-1 border border-slate-300 text-center`}>
          {isSigned ? (
            <div className="text-emerald-700 font-bold text-[9.5px] text-center leading-tight">
              {recordedDate}
            </div>
          ) : (
            <div className="w-14 mx-auto pt-2 border-b border-dotted border-slate-400 text-[8px] text-slate-400 text-center">
              ว/ด/ป
            </div>
          )}
        </td>
      </tr>
    );
  };

  const renderDocumentHeader = (group: ManifestPrintGroup) => {
    const signedCount = group.parcels.filter((p) => p.status === 'ส่งมอบสำเร็จ').length;
    const unsignedCount = group.parcels.length - signedCount;
    const legalHoldCount = group.parcels.filter((p) => p.status === 'ติดนิติการ').length;
    const infirmaryCount = group.parcels.filter((p) => p.status === 'ติดต่องานพยาบาล').length;

    return (
      <header className="border-b-2 border-slate-900 pb-2 mb-2 flex flex-row items-center justify-between gap-3 shrink-0">
        <div className="space-y-0.5 min-w-0">
          <h1 className="text-base sm:text-[17px] font-extrabold text-slate-900 tracking-tight leading-snug">
            ใบรายการนำส่งและลงนามรับพัสดุนักเรียนประจำหอพัก
          </h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-slate-600 font-mono">
            <span>วันที่พิมพ์: <strong className="text-slate-900">{printDateDisplay}</strong></span>
            {selectedDate && (
              <span>· รับเข้า: <strong className="text-slate-900">{formatThaiSlashDate(selectedDate)}</strong></span>
            )}
            {selectedStatusLabel && (
              <span>· ตัวกรอง: <strong className="text-slate-900">{selectedStatusLabel}</strong></span>
            )}
            {selectedSortLabel && (
              <span>· เรียงตาม: <strong className="text-slate-900">{selectedSortLabel}</strong></span>
            )}
            <span>· รวมทั้งหมด <strong className="text-slate-900">{group.parcels.length}</strong> รายการ</span>
            <span>
              (เซ็นแล้ว {signedCount} / รอเซ็น {unsignedCount}
              {infirmaryCount > 0 ? `, งานพยาบาล ${infirmaryCount}` : ''}
              {legalHoldCount > 0 ? `, ติดนิติการ ${legalHoldCount}` : ''})
            </span>
          </div>
        </div>

        {/* ป้ายแสดงหอพักและรหัสตะกร้าสี (ใส่สีตะกร้าหอพัก) */}
        <div
          className={`dorm-basket-badge border-2 ${group.theme.borderClass} ${group.theme.bgClass} rounded-lg px-2.5 py-1 text-right shrink-0 shadow-2xs`}
          style={{
            borderColor: group.theme.hexColor || undefined,
            WebkitPrintColorAdjust: 'exact',
            printColorAdjust: 'exact',
          }}
        >
          <div className={`text-xs sm:text-sm font-extrabold leading-tight ${group.theme.textClass}`}>
            {group.dormitory === 'ALL' ? 'ทุกหอพักรวม' : group.theme.name}
          </div>
          <div className="text-[10px] font-mono font-bold text-slate-800 flex items-center justify-end gap-1.5 mt-0.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full border border-slate-900/20 shrink-0"
              style={{
                backgroundColor: group.theme.hexColor,
                WebkitPrintColorAdjust: 'exact',
                printColorAdjust: 'exact',
              }}
            />
            <span>
              {group.theme.basketCode} ({group.theme.colorName})
            </span>
          </div>
        </div>
      </header>
    );
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ตัวอย่างการพิมพ์ใบนำส่งหอพัก"
      className="fixed inset-0 z-50 flex flex-col bg-white modal-print-wrapper overflow-hidden"
    >
      {/* Dynamic @page CSS rule and A4 multi-page layout rules */}
      <style>{`
        @media print {
          @page {
            size: A4 ${orientation};
            margin: 6mm;
          }
          html, body {
            background-color: #FFFFFF !important;
            background: #FFFFFF !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
            color: #000000 !important;
          }
          #root,
          .no-print,
          .print-container {
            display: none !important;
          }
          .modal-print-wrapper,
          .print-preview-scroll-area {
            position: static !important;
            inset: auto !important;
            background: #FFFFFF !important;
            background-color: #FFFFFF !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
            height: auto !important;
            min-height: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            display: block !important;
          }
          .manifest-pages-stack {
            transform: none !important;
            gap: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            width: 100% !important;
            display: block !important;
          }
          .manifest-a4-page {
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            height: ${isLandscape ? '188mm' : '274mm'} !important;
            min-height: 0 !important;
            max-height: ${isLandscape ? '188mm' : '274mm'} !important;
            display: flex !important;
            flex-direction: column !important;
            box-sizing: border-box !important;
            background-color: #FFFFFF !important;
            background: #FFFFFF !important;
            overflow: hidden !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            break-after: page !important;
            page-break-after: always !important;
          }
          .manifest-a4-page:last-child,
          .manifest-a4-page:last-of-type {
            break-after: auto !important;
            page-break-after: auto !important;
          }

          .print-page-number {
            color: #000000 !important;
            font-weight: 800 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* ตารางรายการพัสดุ */
          table {
            width: 100% !important;
            max-width: 100% !important;
            table-layout: fixed !important;
            border-collapse: collapse !important;
            box-sizing: border-box !important;
            background-color: #FFFFFF !important;
            background: #FFFFFF !important;
            border: 1px solid #000000 !important;
          }

          /* ใส่สีหัวตาราง */
          thead {
            display: table-header-group !important;
          }
          thead tr {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            border-top: 2px solid #000000 !important;
            border-bottom: 2px solid #000000 !important;
            background-color: #F1F5F9 !important;
            background: #F1F5F9 !important;
          }
          thead th {
            background-color: #F1F5F9 !important;
            background: #F1F5F9 !important;
            color: #000000 !important;
            border: 1px solid #334155 !important;
            border-top: 2px solid #000000 !important;
            border-bottom: 2px solid #000000 !important;
            font-weight: 700 !important;
            text-align: center !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* เนื้อหาตาราง และสีไฮไลท์สถานะแถว */
          tbody {
            display: table-row-group !important;
            background-color: #FFFFFF !important;
            background: #FFFFFF !important;
          }
          tbody tr {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          tbody tr:not(.print-highlight-legal):not(.print-highlight-infirmary),
          tbody tr:not(.print-highlight-legal):not(.print-highlight-infirmary) td {
            background-color: #FFFFFF !important;
            background: #FFFFFF !important;
            color: #000000 !important;
            border: 1px solid #64748B !important;
          }
          tbody tr.print-highlight-legal,
          tbody tr.print-highlight-legal td {
            background-color: #FEF1F0 !important;
            background: #FEF1F0 !important;
            color: #000000 !important;
            border: 1px solid #64748B !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          tbody tr.print-highlight-infirmary,
          tbody tr.print-highlight-infirmary td {
            background-color: #FFFBEB !important;
            background: #FFFBEB !important;
            color: #000000 !important;
            border: 1px solid #64748B !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .dorm-basket-badge,
          .dorm-basket-badge * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .print-rd-category,
          tbody tr td.print-rd-category,
          tbody tr td .print-rd-category {
            color: #DC2626 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .print-green-tracking,
          td.print-green-tracking,
          td .print-green-tracking,
          div.print-green-tracking,
          span.print-green-tracking,
          tbody tr td.print-green-tracking,
          tbody tr td .print-green-tracking,
          tbody tr:not(.print-highlight-legal):not(.print-highlight-infirmary) td.print-green-tracking,
          tbody tr:not(.print-highlight-legal):not(.print-highlight-infirmary) td .print-green-tracking,
          tbody tr.print-highlight-infirmary td.print-green-tracking,
          tbody tr.print-highlight-infirmary td .print-green-tracking {
            color: #166534 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .print-legal-tracking,
          td.print-legal-tracking,
          td .print-legal-tracking,
          div.print-legal-tracking,
          span.print-legal-tracking,
          tbody tr td.print-legal-tracking,
          tbody tr td .print-legal-tracking,
          tbody tr.print-highlight-legal td.print-legal-tracking,
          tbody tr.print-highlight-legal td .print-legal-tracking,
          tbody tr.print-highlight-legal .print-legal-tracking {
            color: #DC2626 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .print-black-tracking,
          td .print-black-tracking,
          div.print-black-tracking,
          span.print-black-tracking,
          tbody tr td.print-black-tracking,
          tbody tr td .print-black-tracking {
            color: #000000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .print-reg-date-time,
          .print-student-parcel-summary {
            color: #166534 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print-legal-tag {
            color: #DC2626 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>

      {/* ตัววัดขนาดความสูงแถวแบบซ่อนบนหน้าจอ เพื่อให้การแบ่งหน้า A4 แม่นยำตรงกับการพิมพ์จริง */}
      <div
        ref={measureRootRef}
        aria-hidden="true"
        style={{
          width: isLandscape ? `${PRINT_WIDTH_PX_LANDSCAPE}px` : `${PRINT_WIDTH_PX_PORTRAIT}px`,
        }}
        className="no-print fixed -left-[99999px] top-0 pointer-events-none opacity-0 bg-white text-slate-900"
      >
        <div data-measure="top-bar" className="flex items-center justify-between gap-2 mb-1.5 pb-1 border-b border-slate-200 text-xs font-mono">
          <span className="text-[10.5px] font-semibold text-slate-600">ใบนำส่ง</span>
          <span className="font-extrabold text-xs tabular-nums px-2 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-900">
            หน้าที่ 1 / 1
          </span>
        </div>

        {manifestGroups.map((group) => (
          <div key={`m-hdr-${group.key}`} data-measure-header={group.key}>
            {renderDocumentHeader(group)}
          </div>
        ))}

        <table className="w-full table-fixed border-collapse text-left border border-slate-400 bg-white">
          {renderTableHeader()}
          <tbody className={isLandscape ? 'table-row-group text-[10.5px]' : 'table-row-group text-[10px]'}>
            {manifestGroups.flatMap((group) =>
              group.parcels.map((p, idx) =>
                renderParcelRow(
                  p,
                  idx + 1,
                  `m-row-${group.key}-${p.id}-${idx}`,
                  `${group.key}::${p.id}::${idx}`
                )
              )
            )}
          </tbody>
        </table>

        <footer
          data-measure="footer"
          className="pt-1.5 border-t border-slate-300 text-[10px] text-slate-600 space-y-0.5"
        >
          <div className="font-mono">
            รวมทั้งสิ้น 000 รายการ (ส่งมอบแล้ว 000 / รอส่งมอบ 000 / ติดนิติการ 000) · หน้านี้ลำดับที่ 1–25
          </div>
          <div className="text-[9px] font-sans">
            * เลขพัสดุ: สีดำ = บาร์โค้ดปกติ · สีเขียวเข้ม = ขึ้นต้นด้วย &quot;PRT&quot; และเลขพัสดุที่ทำการสุ่มด้วยระบบ · สีแดง = พัสดุติดนิติการ
          </div>
        </footer>
      </div>

      {/* แถบเครื่องมือควบคุมการพิมพ์ (Toolbar) - ซ่อนอัตโนมัติเมื่อพิมพ์ด้วย class no-print */}
      <header className="no-print bg-white border-b border-slate-200 px-4 py-3 shrink-0 text-slate-900 shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-col gap-2.5">
          {/* แถวที่ 1: ข้อมูลหัวเรื่อง & สรุป */}
          <div className="flex items-center justify-between gap-3 w-full">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                <Printer className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight truncate">
                    ตัวอย่างการพิมพ์ใบนำส่งหอพัก
                  </h2>
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                    A4 {isLandscape ? 'แนวนอน' : 'แนวตั้ง'}
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                    {totalPagesCount} หน้า
                  </span>
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {currentDormSummaryText} · รวม {totalDisplayedParcels} ชิ้น · พิมพ์ซ้ำหัวกระดาษและแสดง &quot;หน้าที่ / &quot; ด้านบนทุกหน้า
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              aria-label="ปิดหน้าต่างตัวอย่าง"
              title="ปิด (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* แถวที่ 2: ตัวเลือกเลือกพิมพ์หอพัก + แผงควบคุมการพิมพ์ทั้งหมด */}
          <div className="flex flex-wrap items-center justify-between gap-2 w-full pt-2 border-t border-slate-100">
            {/* ตัวเลือกเลือกพิมพ์หอพัก */}
            <div className="flex items-center gap-2 bg-emerald-50/70 border border-emerald-200 rounded-xl px-2.5 py-1">
              <Building2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <label
                htmlFor="print-dorm-select"
                className="text-xs font-bold text-emerald-950 whitespace-nowrap"
              >
                เลือกพิมพ์หอพัก:
              </label>
              <select
                id="print-dorm-select"
                value={printDormitory}
                onChange={(e) => setPrintDormitory(e.target.value)}
                className="bg-white border border-emerald-300 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer max-w-[260px]"
              >
                <option value="ALL">
                  ทุกหอพักรวมกัน ({sourceParcels.length} ชิ้น)
                </option>
                <option value={SEPARATE_BY_DORM_VALUE}>
                  พิมพ์แยกทีละหอพัก (ทุกหอ · {sourceParcels.length} ชิ้น)
                </option>
                {dormitoryOptions.map((dormName) => {
                  const count = dormCountMap.get(dormName) || 0;
                  const theme = getDormitoryTheme(dormName);
                  return (
                    <option key={dormName} value={dormName}>
                      {dormName} ({theme.basketCode}) · {count} ชิ้น
                    </option>
                  );
                })}
                {(dormCountMap.get('ยังไม่ระบุหอพัก') || 0) > 0 && (
                  <option value="ยังไม่ระบุหอพัก">
                    ยังไม่ระบุหอพัก · {dormCountMap.get('ยังไม่ระบุหอพัก')} ชิ้น
                  </option>
                )}
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
              {/* เลือกลักษณะการพิมพ์: แนวตั้ง / แนวนอน */}
              <div className="flex items-center bg-slate-100 border border-slate-200 rounded-xl p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setOrientation('portrait')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    !isLandscape
                      ? 'bg-white text-emerald-700 shadow-xs border border-slate-200/60'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                  title="พิมพ์แบบแนวตั้ง กระดาษ A4 (210 × 297 มม.)"
                >
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5" y="2" width="14" height="20" rx="2" />
                  </svg>
                  <span>แนวตั้ง (Portrait)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setOrientation('landscape')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    isLandscape
                      ? 'bg-white text-emerald-700 shadow-xs border border-slate-200/60'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                  title="พิมพ์แบบแนวนอน กระดาษ A4 (297 × 210 มม.)"
                >
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="5" width="20" height="14" rx="2" />
                  </svg>
                  <span>แนวนอน (Landscape)</span>
                </button>
              </div>

              {/* ความหนาแน่นตาราง */}
              <div className="flex items-center bg-slate-100 border border-slate-200 rounded-xl p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setDensity('compact')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    density === 'compact'
                      ? 'bg-white text-emerald-700 font-bold shadow-xs border border-slate-200/60'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                  title="โหมดกะทัดรัด (แนะนำ): ประหยัดกระดาษ"
                >
                  ประหยัดหน้า (กะทัดรัด)
                </button>
                <button
                  type="button"
                  onClick={() => setDensity('normal')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    density === 'normal'
                      ? 'bg-white text-slate-900 font-bold shadow-xs border border-slate-200/60'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                  title="ระยะบรรทัดปกติ"
                >
                  ขนาดปกติ
                </button>
              </div>

              {/* ปรับสัดส่วนการมองเห็น */}
              <div className="flex items-center bg-slate-100 border border-slate-200 rounded-xl px-2 py-1 gap-1.5 text-xs text-slate-700">
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.max(50, z - 10))}
                  disabled={zoomLevel <= 50}
                  className="p-1 text-slate-500 hover:text-slate-800 disabled:opacity-40 cursor-pointer"
                  title="ลดขนาดตัวอย่าง"
                  aria-label="ลดขนาดตัวอย่าง"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono font-bold w-16 text-center text-slate-800">ซูม {zoomLevel}%</span>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.min(130, z + 10))}
                  disabled={zoomLevel >= 130}
                  className="p-1 text-slate-500 hover:text-slate-800 disabled:opacity-40 cursor-pointer"
                  title="เพิ่มขนาดตัวอย่าง"
                  aria-label="เพิ่มขนาดตัวอย่าง"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoomLevel(100)}
                  className="px-1.5 py-0.5 text-[10px] bg-white hover:bg-slate-50 rounded text-slate-700 border border-slate-200 cursor-pointer ml-0.5 font-medium shadow-2xs"
                  title="รีเซ็ตเป็น 100%"
                >
                  100%
                </button>
              </div>

              {/* ปุ่มสั่งพิมพ์ */}
              <button
                type="button"
                onClick={handlePrint}
                className="min-h-[36px] px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm hover:shadow-emerald-600/20"
              >
                <Printer className="w-4 h-4" />
                <span>สั่งพิมพ์ (Print A4)</span>
              </button>

              {/* ปุ่มปิด */}
              <button
                type="button"
                onClick={onClose}
                className="min-h-[36px] px-3.5 py-1.5 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 hover:text-slate-900 text-xs font-semibold rounded-xl border border-slate-300 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <X className="w-4 h-4" />
                <span>ปิด</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* พื้นที่แสดงตัวอย่างเอกสาร A4 แยกทีละหน้า พร้อมหัวกระดาษซ้ำและเลขหน้าที่มุมบนขวา-ล่างขวาทุกหน้า */}
      <main className="flex-1 overflow-auto print-preview-scroll-area p-4 sm:p-6 lg:p-8 flex justify-center items-start bg-slate-100">
        <div
          style={{
            transform: zoomLevel !== 100 ? `scale(${zoomLevel / 100})` : undefined,
            transformOrigin: 'top center',
            transition: 'transform 0.15s ease-out',
          }}
          className="manifest-pages-stack flex flex-col items-center gap-6"
        >
          {resolvedPages.map(({ group, chunk, pageNumber, totalPages, pageKey }) => {
            const signedCount = group.parcels.filter((p) => p.status === 'ส่งมอบสำเร็จ').length;
            const unsignedCount = group.parcels.length - signedCount;
            const legalHoldCount = group.parcels.filter((p) => p.status === 'ติดนิติการ').length;
            const colSpan = isLandscape ? 8 : 7;

            return (
              <section
                key={pageKey}
                aria-label={`ใบนำส่ง ${group.dormitory === 'ALL' ? 'ทุกหอพักรวม' : group.theme.name} หน้าที่ ${pageNumber} จาก ${totalPages}`}
                className={`manifest-a4-page bg-white text-slate-900 shadow-xl rounded-sm p-[22px] border border-slate-300 flex flex-col box-border shrink-0 ${
                  isLandscape
                    ? 'w-[1123px] min-h-[794px]'
                    : 'w-[794px] min-h-[1123px]'
                }`}
              >
                {/* แถวบนสุด: เลขหน้าที่ (หน้าที่ X / Y) ด้านบนของทุกหน้า */}
                <div className="flex items-center justify-between gap-2 mb-1.5 pb-1 border-b border-slate-200 text-xs font-mono shrink-0">
                  <span className="text-[10.5px] font-semibold text-slate-600 truncate">
                    {group.dormitory === 'ALL'
                      ? 'ใบนำส่งรวมทุกหอพัก'
                      : `${group.theme.name} (${group.theme.basketCode})`}
                  </span>
                  <span className="font-extrabold text-xs text-slate-900 tabular-nums shrink-0 px-2 py-0.5 rounded bg-slate-100 border border-slate-300 print-page-number">
                    หน้าที่ {pageNumber} / {totalPages}
                  </span>
                </div>

                {/* หัวกระดาษ (พิมพ์ซ้ำทุกหน้า) */}
                {renderDocumentHeader(group)}

                {/* ตารางรายการพัสดุสำหรับหน้านี้ */}
                <div className="w-full overflow-hidden">
                  <table className="w-full table-fixed border-collapse text-left border border-slate-400 bg-white">
                    {renderTableHeader()}
                    <tbody className={isLandscape ? 'table-row-group text-[10.5px]' : 'table-row-group text-[10px]'}>
                      {chunk.parcels.length === 0 ? (
                        <tr>
                          <td colSpan={colSpan} className="py-8 text-center text-slate-500 border border-slate-300">
                            ไม่มีรายการพัสดุที่ตรงกับเงื่อนไขในขณะนี้
                          </td>
                        </tr>
                      ) : (
                        chunk.parcels.map((p, idxInPage) =>
                          renderParcelRow(
                            p,
                            chunk.startIndex + idxInPage + 1,
                            `${pageKey}::${p.id}::${idxInPage}`
                          )
                        )
                      )}
                    </tbody>
                  </table>
                </div>

                {/* ท้ายกระดาษ: สรุปข้อมูลรายการนำส่ง (ย้ายเลขหน้าที่ไปด้านบนของทุกหน้าแล้ว) */}
                <footer className="mt-auto pt-1.5 border-t border-slate-300 text-[10px] text-slate-600 shrink-0 space-y-0.5">
                  <div className="font-mono">
                    รวมทั้งสิ้น <strong>{group.parcels.length}</strong> รายการ (ส่งมอบแล้ว {signedCount} / รอส่งมอบ {unsignedCount}
                    {legalHoldCount > 0 ? ` / ติดนิติการ ${legalHoldCount}` : ''})
                    {totalPages > 1 && chunk.parcels.length > 0 && (
                      <span className="ml-1.5 text-slate-500">
                        · หน้านี้ลำดับที่ {chunk.startIndex + 1}–{chunk.startIndex + chunk.parcels.length}
                      </span>
                    )}
                  </div>
                  <div className="text-[9px] text-slate-500 font-sans">
                    * เลขพัสดุ: <span className="font-bold text-slate-900">สีดำ</span> = บาร์โค้ดปกติ ·{' '}
                    <span className="font-bold text-emerald-800">สีเขียวเข้ม</span> = ขึ้นต้นด้วย &quot;PRT&quot; และเลขพัสดุที่ทำการสุ่มด้วยระบบ ·{' '}
                    <span className="font-bold text-red-600">สีแดง</span> = พัสดุติดนิติการ
                  </div>
                </footer>
              </section>
            );
          })}
        </div>
      </main>
    </div>,
    document.body
  );
};
