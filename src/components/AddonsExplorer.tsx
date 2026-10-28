import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { marked } from 'marked';
import { normalizeYouTubeEmbeds } from '../projectEmbedUtils';

export interface InstallationOption {
  id: string;
  name: string;
  type?: string;
  version?: string;
  gameDirectory?: string;
  fabricVersion?: string;
  forgeVersion?: string;
  neoforgeVersion?: string;
  quiltVersion?: string;
  customIcon?: string;
}

interface AddonsExplorerProps {
  installations: InstallationOption[];
  defaultInstanceId?: string;
  theme?: string;
  onOpenFolder?: (path: string) => void;
  onClose?: () => void;
}

interface ModrinthSearchResult {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  categories: string[];
  client_side: string;
  server_side: string;
  project_type: string;
  downloads: number;
  follows: number;
  icon_url?: string;
  author: string;
  versions: string[];
  display_categories: string[];
  date_modified: string;
  latest_version?: string;
  source?: 'modrinth' | 'curseforge';
}

interface ModrinthProjectDetails {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  icon_url?: string;
  downloads: number;
  followers: number;
  categories: string[];
  loaders: string[];
  game_versions: string[];
  license?: { id: string; name: string; url?: string };
  client_side: string;
  server_side: string;
  gallery: Array<{
    url: string;
    featured: boolean;
    title?: string;
    description?: string;
    created: string;
  }>;
  source_url?: string;
  issues_url?: string;
  wiki_url?: string;
  discord_url?: string;
  source?: 'modrinth' | 'curseforge';
}

interface ModrinthVersionItem {
  id: string;
  name: string;
  version_number: string;
  changelog?: string;
  dependencies: Array<{
    version_id?: string;
    project_id?: string;
    file_name?: string;
    dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded';
  }>;
  game_versions: string[];
  version_type: 'release' | 'beta' | 'alpha';
  loaders: string[];
  featured: boolean;
  downloads: number;
  date_published: string;
  files: Array<{
    url: string;
    filename: string;
    primary: boolean;
    size: number;
  }>;
  source?: 'modrinth' | 'curseforge';
}

interface InstalledResourceItem {
  name: string;
  filename?: string;
  fileName?: string;
  version?: string;
  path?: string;
}

const CURSEFORGE_CLASS_IDS: Record<string, number> = {
  mod: 6,
  shader: 6552,
  resourcepack: 12,
  datapack: 6945,
};

const ADDON_CATEGORIES: Record<string, Array<{ id: string; name: string; label: string }>> = {
  mod: [
    { id: 'optimization', name: 'optimization', label: 'Optimización' },
    { id: 'technology', name: 'technology', label: 'Tecnología' },
    { id: 'magic', name: 'magic', label: 'Magia' },
    { id: 'adventure', name: 'adventure', label: 'Aventura' },
    { id: 'decoration', name: 'decoration', label: 'Decoración' },
    { id: 'worldgen', name: 'worldgen', label: 'Generación de Mundo' },
    { id: 'equipment', name: 'equipment', label: 'Equipamiento & Armas' },
    { id: 'food', name: 'food', label: 'Comida & Agricultura' },
    { id: 'storage', name: 'storage', label: 'Almacenamiento' },
    { id: 'utility', name: 'utility', label: 'Utilidad & Herramientas' },
    { id: 'mobs', name: 'mobs', label: 'Criaturas & Jefes' },
    { id: 'game-mechanics', name: 'game-mechanics', label: 'Mecánicas' },
    { id: 'social', name: 'social', label: 'Multijugador' },
  ],
  shader: [
    { id: 'realistic', name: 'realistic', label: 'Realista' },
    { id: 'fantasy', name: 'fantasy', label: 'Fantasía' },
    { id: 'performance', name: 'performance', label: 'Bajos Recursos' },
    { id: 'vanilla-plus', name: 'vanilla-plus', label: 'Vanilla+' },
    { id: 'stylized', name: 'stylized', label: 'Estilizado' },
  ],
  resourcepack: [
    { id: '16x', name: '16x', label: '16x (Default)' },
    { id: '32x', name: '32x', label: '32x (HD)' },
    { id: '64x', name: '64x', label: '64x (Fidelity)' },
    { id: 'medieval', name: 'medieval', label: 'Medieval' },
    { id: 'modern', name: 'modern', label: 'Moderna' },
    { id: 'steampunk', name: 'steampunk', label: 'Steampunk' },
    { id: 'futuristic', name: 'futuristic', label: 'Futurista' },
    { id: 'gui', name: 'gui', label: 'Interfaz (UI)' },
  ],
  datapack: [
    { id: 'adventure', name: 'adventure', label: 'Aventura' },
    { id: 'worldgen', name: 'worldgen', label: 'Generación' },
    { id: 'magic', name: 'magic', label: 'Magia' },
    { id: 'utility', name: 'utility', label: 'Utilidad' },
    { id: 'game-mechanics', name: 'game-mechanics', label: 'Mecánicas' },
  ]
};

const CURSEFORGE_CATEGORIES: Record<string, Array<{ id: string; categoryId: number; label: string }>> = {
  mod: [
    { id: 'technology', categoryId: 423, label: 'Tecnología' },
    { id: 'magic', categoryId: 419, label: 'Magia' },
    { id: 'adventure', categoryId: 424, label: 'Aventura & RPG' },
    { id: 'storage', categoryId: 421, label: 'Almacenamiento' },
    { id: 'decoration', categoryId: 412, label: 'Decoración' },
    { id: 'utility', categoryId: 422, label: 'Utilidad & QoL' },
    { id: 'worldgen', categoryId: 406, label: 'Generación de Mundo' },
    { id: 'food', categoryId: 416, label: 'Comida & Agricultura' },
    { id: 'equipment', categoryId: 417, label: 'Equipamiento & Armas' },
    { id: 'mobs', categoryId: 414, label: 'Criaturas & Jefes' },
    { id: 'game-mechanics', categoryId: 420, label: 'Mecánicas' },
    { id: 'social', categoryId: 425, label: 'Multijugador' },
  ],
  shader: [
    { id: 'performance', categoryId: 6553, label: 'Bajos Recursos' },
    { id: 'realistic', categoryId: 6554, label: 'Realista' },
    { id: 'fantasy', categoryId: 6555, label: 'Fantasía' },
  ],
  resourcepack: [
    { id: '16x', categoryId: 392, label: '16x (Default)' },
    { id: '32x', categoryId: 393, label: '32x (HD)' },
    { id: '64x', categoryId: 394, label: '64x (Fidelity)' },
    { id: 'traditional', categoryId: 398, label: 'Vanilla+' },
    { id: 'modern', categoryId: 402, label: 'Moderna' },
    { id: 'medieval', categoryId: 401, label: 'Medieval' },
    { id: 'steampunk', categoryId: 404, label: 'Steampunk' },
    { id: 'futuristic', categoryId: 405, label: 'Futurista' },
    { id: 'gui', categoryId: 397, label: 'Interfaz (UI)' },
  ],
  datapack: [
    { id: 'adventure', categoryId: 6946, label: 'Aventura' },
    { id: 'worldgen', categoryId: 6947, label: 'Generación' },
    { id: 'magic', categoryId: 6948, label: 'Magia' },
    { id: 'utility', categoryId: 6949, label: 'Utilidad' },
    { id: 'game-mechanics', categoryId: 6950, label: 'Mecánicas' },
  ]
};

const COMMON_MC_VERSIONS = [
  '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21',
  '1.20.6', '1.20.4', '1.20.2', '1.20.1', '1.20',
  '1.19.4', '1.19.2', '1.18.2', '1.16.5', '1.12.2', '1.8.9', '1.7.10'
];

export function AddonsExplorer({
  installations,
  defaultInstanceId,
  theme = 'white',
  onOpenFolder,
  onClose,
}: AddonsExplorerProps) {
  const PAGE_LIMIT = 20;

  const [addonSource, setAddonSource] = useState<'modrinth' | 'curseforge'>('modrinth');

  const [selectedInstId, setSelectedInstId] = useState<string>(() => {
    if (defaultInstanceId && installations.some(i => i.id === defaultInstanceId)) {
      return defaultInstanceId;
    }
    return installations[0]?.id || '';
  });

  const selectedInst = installations.find(i => i.id === selectedInstId);

  const [activeType, setActiveType] = useState<'mod' | 'shader' | 'resourcepack' | 'datapack'>('mod');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'downloads' | 'relevance' | 'follows' | 'newest' | 'updated'>('downloads');
  const [filterByInstance, setFilterByInstance] = useState<boolean>(true);

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [selectedLoaders, setSelectedLoaders] = useState<string[]>([]);
  const [versionSearch, setVersionSearch] = useState<string>('');
  const [expandedSections, setExpandedSections] = useState<string[]>(['categories', 'game_version', 'loader']);

  const [results, setResults] = useState<ModrinthSearchResult[]>([]);
  const [totalHits, setTotalHits] = useState<number>(() => {
    try {
      const cached = localStorage.getItem('cached_total_addons');
      return cached ? parseInt(cached, 10) || 19133 : 19133;
    } catch {
      return 19133;
    }
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [offset, setOffset] = useState<number>(0);

  const [installedMods, setInstalledMods] = useState<InstalledResourceItem[]>([]);
  const [installedShaders, setInstalledShaders] = useState<InstalledResourceItem[]>([]);
  const [installedResourcePacks, setInstalledResourcePacks] = useState<InstalledResourceItem[]>([]);
  const [installedInventoryReady, setInstalledInventoryReady] = useState(false);
  const inventoryRequestId = useRef(0);

  const [selectedProject, setSelectedProject] = useState<ModrinthProjectDetails | null>(null);
  const [projectLoading, setProjectLoading] = useState<boolean>(false);
  const [projectTab, setProjectTab] = useState<'description' | 'versions' | 'gallery'>('description');
  
  const [projectVersions, setProjectVersions] = useState<ModrinthVersionItem[]>([]);
  const [versionsLoading, setVersionsLoading] = useState<boolean>(false);
  const [filterCompatibleVersions, setFilterCompatibleVersions] = useState<boolean>(true);
  const [versionPage, setVersionPage] = useState<number>(1);
  const [expandedChangelogs, setExpandedChangelogs] = useState<Record<string, boolean>>({});
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);

  const [installingProjectIds, setInstallingProjectIds] = useState<Set<string>>(() => new Set());
  const installLocks = useRef(new Set<string>());
  const [installStatusMsg, setInstallStatusMsg] = useState<{ title: string; desc: string; type: 'success' | 'error' } | null>(null);

  const loadLocalInstalledResources = useCallback(async () => {
    const requestId = ++inventoryRequestId.current;
    if (!selectedInst) {
      setInstalledMods([]);
      setInstalledShaders([]);
      setInstalledResourcePacks([]);
      setInstalledInventoryReady(true);
      return;
    }

    setInstalledInventoryReady(false);
    setInstalledMods([]);
    setInstalledShaders([]);
    setInstalledResourcePacks([]);
    try {
      let instDir = selectedInst.gameDirectory?.trim() || '';
      if (!instDir) {
        const defaultDir = await invoke<string>('get_default_game_directory').catch(() => '');
        instDir = `${defaultDir}/modpacks/${selectedInst.id}`;
      }

      const inventory = await invoke<{ mods: string[]; shaders: string[]; resourcePacks: string[] }>(
        'list_instance_addon_inventory',
        { gameDirectory: instDir },
      );
      if (requestId !== inventoryRequestId.current) return;

      const toItems = (files: string[] = []) => files.map(filename => ({ name: filename, filename }));
      setInstalledMods(toItems(inventory?.mods));
      setInstalledShaders(toItems(inventory?.shaders));
      setInstalledResourcePacks(toItems(inventory?.resourcePacks));
    } catch (e) {
      console.error('Error cargando recursos instalados de la instancia:', e);
      if (requestId === inventoryRequestId.current) {
        setInstalledMods([]);
        setInstalledShaders([]);
        setInstalledResourcePacks([]);
      }
    } finally {
      if (requestId === inventoryRequestId.current) setInstalledInventoryReady(true);
    }
  }, [selectedInst]);

  useEffect(() => {
    loadLocalInstalledResources();
  }, [loadLocalInstalledResources]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setOffset(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const targetVersion = selectedInst?.version || '1.21.1';
  const targetLoader = (selectedInst?.type && selectedInst.type !== 'Vanilla' ? selectedInst.type.toLowerCase() : 'fabric');

  const getCurseForgeLoaderType = (loaderName?: string): number | null => {
    if (!loaderName) return null;
    const l = loaderName.toLowerCase();
    if (l.includes('neoforge')) return 6;
    if (l.includes('forge')) return 1;
    if (l.includes('fabric')) return 4;
    if (l.includes('quilt')) return 5;
    return null;
  };

  const getInstanceIcon = (inst?: InstallationOption) => {
    if (!inst) return '/logo.png';
    if (inst.customIcon) return inst.customIcon;
    const type = (inst.type || '').toLowerCase();
    if (type.includes('fabric')) return '/Fabric.png';
    if (type.includes('neoforge')) return '/Neoforge.png';
    if (type.includes('forge')) return '/Forge.png';
    if (type.includes('quilt')) return '/quilt.png';
    return '/logo.png';
  };

  useEffect(() => {
    let cancelled = false;
    async function searchAddons() {
      setLoading(true);

      if (addonSource === 'curseforge') {
        try {
          const classId = CURSEFORGE_CLASS_IDS[activeType] || 6;
          
          let gameVer: string | null = null;
          if (selectedVersions.length > 0) {
            gameVer = selectedVersions[0];
          } else if (filterByInstance && selectedInst && activeType !== 'shader') {
            gameVer = targetVersion;
          }

          let mlt: number | null = null;
          if (selectedLoaders.length > 0) {
            mlt = getCurseForgeLoaderType(selectedLoaders[0]);
          } else if (filterByInstance && selectedInst && activeType === 'mod') {
            mlt = getCurseForgeLoaderType(targetLoader);
          }

          let catId: number | null = null;
          if (selectedCategories.length > 0) {
            const list = CURSEFORGE_CATEGORIES[activeType] || [];
            const matched = list.find(c => selectedCategories.includes(c.id));
            if (matched) {
              catId = matched.categoryId;
            }
          }

          const cfSortField = sortBy === 'downloads' ? 2 : sortBy === 'relevance' ? 1 : sortBy === 'follows' ? 6 : sortBy === 'updated' ? 3 : sortBy === 'newest' ? 3 : 2;

          const cfData: any = await invoke('search_curseforge', {
            query: debouncedQuery,
            index: offset,
            limit: PAGE_LIMIT,
            gameVersion: gameVer || null,
            modLoaderType: mlt || null,
            categoryId: catId || null,
            classId: classId,
            sortField: cfSortField,
            sortOrder: 'desc',
          });

          if (!cancelled) {
            const rawItems: any[] = cfData?.data || [];
            const normalizedResults: ModrinthSearchResult[] = rawItems.map((item: any) => ({
              project_id: String(item.id),
              slug: item.slug || String(item.id),
              title: item.name || 'Sin título',
              description: item.summary || '',
              categories: (item.categories || []).map((c: any) => c.name || String(c.id)),
              client_side: 'required',
              server_side: 'optional',
              project_type: activeType,
              downloads: item.downloadCount || 0,
              follows: item.thumbsUpCount || 0,
              icon_url: item.logo?.thumbnailUrl || item.logo?.url || '/logo.png',
              author: (item.authors && item.authors.length > 0) ? item.authors[0].name : 'CurseForge',
              versions: [],
              display_categories: (item.categories || []).map((c: any) => c.name || ''),
              date_modified: item.dateModified || '',
              source: 'curseforge',
            }));

            setResults(normalizedResults);
            const total = cfData?.pagination?.totalCount || (normalizedResults.length >= PAGE_LIMIT ? offset + PAGE_LIMIT + 1 : offset + normalizedResults.length);
            setTotalHits(total);
            try { if (total > 0) localStorage.setItem('cached_total_addons', String(total)); } catch {}
          }
        } catch (err) {
          console.error('Error buscando en CurseForge:', err);
          if (!cancelled) {
            setResults([]);
            setTotalHits(0);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }

      try {
        const facets: string[][] = [];
        
        facets.push([`project_type:${activeType}`]);

        if (selectedCategories.length > 0) {
          facets.push(selectedCategories.map(c => `categories:${c.toLowerCase()}`));
        }

        if (selectedLoaders.length > 0) {
          facets.push(selectedLoaders.map(l => `categories:${l.toLowerCase()}`));
        } else if (filterByInstance && selectedInst && (activeType === 'mod' || activeType === 'datapack')) {
          if (targetLoader) {
            facets.push([`categories:${targetLoader}`]);
          }
        }

        if (selectedVersions.length > 0) {
          facets.push(selectedVersions.map(v => `versions:${v}`));
        } else if (filterByInstance && selectedInst) {
          if (targetVersion) {
            facets.push([`versions:${targetVersion}`]);
          }
        }

        const facetsParam = encodeURIComponent(JSON.stringify(facets));
        const sortIndex = sortBy === 'downloads' ? 'downloads' : sortBy === 'follows' ? 'follows' : sortBy === 'newest' ? 'newest' : sortBy === 'updated' ? 'updated' : 'relevance';
        const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(debouncedQuery)}&facets=${facetsParam}&index=${sortIndex}&limit=${PAGE_LIMIT}&offset=${offset}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (!cancelled) {
          const modrinthHits = (data.hits || []).map((h: any) => ({
            ...h,
            source: 'modrinth' as const
          }));
          setResults(modrinthHits);
          const freshHits = data.total_hits || 0;
          setTotalHits(freshHits);
          try { if (freshHits > 0) localStorage.setItem('cached_total_addons', String(freshHits)); } catch {}
        }
      } catch (err) {
        console.error('Error buscando en Modrinth:', err);
        if (!cancelled) {
          setResults([]);
          setTotalHits(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    searchAddons();
    return () => { cancelled = true; };
  }, [addonSource, debouncedQuery, activeType, sortBy, filterByInstance, selectedInstId, targetVersion, targetLoader, selectedCategories, selectedVersions, selectedLoaders, offset]);

  const loadCurseForgeVersions = async (modId: number, onlyCompatible: boolean) => {
    setVersionsLoading(true);
    try {
      const filesData: any = await invoke('get_curseforge_files', { modId });
      const rawFiles: any[] = filesData?.data || [];

      const mappedVers: ModrinthVersionItem[] = rawFiles.map((f: any) => {
        let fileUrl = f.downloadUrl || f.url || '';
        if (!fileUrl && f.id) {
          fileUrl = `https://edge.forgecdn.net/files/${Math.floor(f.id / 1000)}/${f.id % 1000}/${f.fileName || 'file.jar'}`;
        }

        const gameVersions: string[] = f.gameVersions || [];
        const loaders = gameVersions.filter((tag: unknown) =>
          typeof tag === 'string' && /^(forge|neoforge|fabric|quilt)$/i.test(tag)
        );
        const pureMcVersions = gameVersions.filter((tag: unknown) =>
          typeof tag === 'string' && !/^(forge|neoforge|fabric|quilt)$/i.test(tag)
        );

        return {
          id: String(f.id),
          name: f.displayName || f.fileName || `v${f.id}`,
          version_number: f.displayName || f.fileName || `v${f.id}`,
          changelog: f.changelog || '',
          dependencies: (f.dependencies || []).map((d: any) => ({
            project_id: String(d.modId),
            dependency_type: d.relationType === 3 ? 'required' : 'optional'
          })),
          game_versions: pureMcVersions.length > 0 ? pureMcVersions : gameVersions,
          version_type: f.releaseType === 1 ? 'release' : f.releaseType === 2 ? 'beta' : 'alpha',
          loaders: loaders,
          featured: false,
          downloads: f.downloadCount || 0,
          date_published: f.fileDate || '',
          files: [{
            url: fileUrl,
            filename: f.fileName || 'file.jar',
            primary: true,
            size: f.fileLength || 0,
          }],
          source: 'curseforge'
        };
      });

      if (onlyCompatible && selectedInst) {
        const filtered = mappedVers.filter(v => {
          const hasLoader = v.loaders.length === 0 || v.loaders.some(l => l.toLowerCase().includes(targetLoader.toLowerCase()));
          const hasVersion = v.game_versions.length === 0 || v.game_versions.some(gv => gv.includes(targetVersion));
          return hasLoader && hasVersion;
        });
        setProjectVersions(filtered.length > 0 ? filtered : mappedVers);
      } else {
        setProjectVersions(mappedVers);
      }
    } catch (err) {
      console.error('Error cargando versiones de CurseForge:', err);
      setProjectVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  };

  const loadProjectVersions = async (projectId: string, onlyCompatible: boolean) => {
    setVersionsLoading(true);
    try {
      let url = `https://api.modrinth.com/v2/project/${projectId}/version`;
      if (onlyCompatible && selectedInst) {
        const loadersParam = encodeURIComponent(JSON.stringify([targetLoader]));
        const versionsParam = encodeURIComponent(JSON.stringify([targetVersion]));
        url += `?loaders=${loadersParam}&game_versions=${versionsParam}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ModrinthVersionItem[] = await res.json();
      setProjectVersions(data.map(v => ({ ...v, source: 'modrinth' })));
    } catch (err) {
      console.error('Error cargando versiones de Modrinth:', err);
      setProjectVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  };

  const openProjectDetails = async (projectIdOrSlug: string, sourceOverride?: 'modrinth' | 'curseforge') => {
    const currentSource = sourceOverride || addonSource;
    setProjectLoading(true);
    setSelectedProject(null);
    setProjectTab('description');
    setActiveImageIndex(null);
    setExpandedChangelogs({});
    setVersionPage(1);

    if (currentSource === 'curseforge') {
      try {
        const modId = Number(projectIdOrSlug);
        const details: any = await invoke('get_curseforge_project_details', {
          projectId: modId,
          project_id: modId,
          modId: modId,
          id: modId
        });

        const cfModData = details?.mod || details || {};
        const fullBody = details?.description || cfModData?.summary || cfModData?.description || '';
        const gallery = Array.isArray(details?.screenshots)
          ? details.screenshots.map((s: any) => ({
              url: s.url,
              featured: false,
              title: s.title || '',
              description: s.description || '',
              created: ''
            }))
          : [];

        const mappedProject: ModrinthProjectDetails = {
          id: String(cfModData.id || modId),
          slug: cfModData.slug || String(modId),
          title: cfModData.name || 'Sin título',
          description: cfModData.summary || '',
          body: fullBody,
          icon_url: cfModData.logo?.thumbnailUrl || cfModData.logo?.url || '/logo.png',
          downloads: cfModData.downloadCount || 0,
          followers: cfModData.thumbsUpCount || 0,
          categories: (cfModData.categories || []).map((c: any) => c.name || String(c.id)),
          loaders: [],
          game_versions: [],
          license: { id: 'CurseForge', name: 'CurseForge License' },
          client_side: 'required',
          server_side: 'optional',
          gallery,
          source: 'curseforge',
        };

        setSelectedProject(mappedProject);
        loadCurseForgeVersions(modId, filterCompatibleVersions);
      } catch (err) {
        console.error('Error cargando detalles de CurseForge:', err);
      } finally {
        setProjectLoading(false);
      }
      return;
    }

    try {
      const res = await fetch(`https://api.modrinth.com/v2/project/${projectIdOrSlug}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ModrinthProjectDetails = await res.json();
      setSelectedProject({ ...data, source: 'modrinth' });
      loadProjectVersions(data.id, filterCompatibleVersions);
    } catch (err) {
      console.error('Error cargando detalles del proyecto en Modrinth:', err);
    } finally {
      setProjectLoading(false);
    }
  };

  const getInstalledInfo = useCallback((projectSlugOrId: string, projectTitle: string) => {
    const list = activeType === 'shader' ? installedShaders : activeType === 'resourcepack' ? installedResourcePacks : installedMods;
    const cleanSlug = projectSlugOrId.toLowerCase().replace(/[-_]/g, '');
    const cleanTitle = projectTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

    const found = list.find((item) => {
      const fn = (item.filename || item.fileName || item.name || '').toLowerCase().replace(/[-_]/g, '');
      const itName = (item.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return fn.includes(cleanSlug) || itName.includes(cleanTitle) || fn.includes(cleanTitle);
    });

    if (found) {
      return {
        isInstalled: true,
        filename: found.filename || found.fileName || found.name,
        name: found.name,
        version: found.version,
      };
    }

    return {
      isInstalled: false,
      filename: undefined,
      name: undefined,
      version: undefined,
    };
  }, [activeType, installedMods, installedShaders, installedResourcePacks]);

  const handleInstallAddon = async (
    projectId: string,
    versionId?: string,
    customTitle?: string,
    oldFileName?: string,
    sourceOverride?: 'modrinth' | 'curseforge'
  ) => {
    if (!selectedInst) {
      alert('Por favor, selecciona primero una instalación destino arriba.');
      return;
    }

    if (!installedInventoryReady) return;
    const installKey = `${selectedInst.id}:${activeType}:${projectId}`;
    if (installLocks.current.has(installKey)) return;
    installLocks.current.add(installKey);
    setInstallingProjectIds(current => new Set(current).add(projectId));

    const title = customTitle || selectedProject?.title || 'Addon';
    const effectiveSource = sourceOverride || selectedProject?.source || addonSource;

    try {
      let instDir = selectedInst.gameDirectory?.trim() || '';
      if (!instDir) {
        const defaultDir = await invoke<string>('get_default_game_directory').catch(() => '');
        instDir = `${defaultDir}/modpacks/${selectedInst.id}`;
      }

      let result: any;
      if (effectiveSource === 'curseforge') {
        result = await invoke('install_curseforge_addon', {
          gameDirectory: instDir,
          addonId: Number(projectId),
          fileId: versionId ? Number(versionId) : null,
          mcVersion: targetVersion,
          loader: targetLoader,
          addonType: activeType,
          oldFileName: oldFileName || null,
        });
      } else {
        result = await invoke('install_modrinth_addon_with_dependencies', {
          gameDirectory: instDir,
          projectIdOrSlug: projectId,
          versionId: versionId || null,
          mcVersion: targetVersion,
          loader: targetLoader,
          addonType: activeType,
          oldFileName: oldFileName || null,
        });
      }

      await loadLocalInstalledResources();

      if (result.dependencies && result.dependencies.length > 0) {
        setInstallStatusMsg({
          title: `¡${title} instalado!`,
          desc: `Se descargó el archivo principal y ${result.dependencies.length} dependencias obligatorias: ${result.dependencies.join(', ')}.`,
          type: 'success',
        });
      } else {
        setInstallStatusMsg({
          title: `¡${title} instalado!`,
          desc: `Archivo ${result.main_file} instalado correctamente${oldFileName ? ` (reemplazó versión anterior)` : ''}.`,
          type: 'success',
        });
      }
      setTimeout(() => setInstallStatusMsg(null), 5000);
    } catch (err: any) {
      console.error('Error en instalación:', err);
      setInstallStatusMsg({
        title: `Error al instalar ${title}`,
        desc: String(err) || 'No se encontró versión compatible para esta instancia.',
        type: 'error',
      });
      setTimeout(() => setInstallStatusMsg(null), 6000);
    } finally {
      installLocks.current.delete(installKey);
      setInstallingProjectIds(current => {
        const next = new Set(current);
        next.delete(projectId);
        return next;
      });
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev =>
      prev.includes(section) ? prev.filter(s => s !== section) : [...prev, section]
    );
  };

  const clearAllFilters = () => {
    setSelectedCategories([]);
    setSelectedVersions([]);
    setSelectedLoaders([]);
    setSearchQuery('');
    setFilterByInstance(false);
    setOffset(0);
  };

  const hasActiveFilters = selectedCategories.length > 0 || selectedVersions.length > 0 || selectedLoaders.length > 0 || searchQuery.trim() !== '';

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'k';
    return num.toString();
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const totalPages = Math.ceil(totalHits / PAGE_LIMIT) || 1;
  const currentPage = Math.floor(offset / PAGE_LIMIT) + 1;

  const VERSIONS_PER_PAGE = 10;
  const totalVersionPages = Math.ceil(projectVersions.length / VERSIONS_PER_PAGE) || 1;
  const paginatedVersions = projectVersions.slice((versionPage - 1) * VERSIONS_PER_PAGE, versionPage * VERSIONS_PER_PAGE);

  const parsedDescriptionHtml = useMemo(() => {
    if (!selectedProject) return '';
    const rawContent = selectedProject.body || selectedProject.description || '';
    if (selectedProject.source === 'curseforge') {
      return normalizeYouTubeEmbeds(rawContent);
    }
    try {
      const parsed = marked.parse(rawContent, { gfm: true, breaks: true }) as string;
      return normalizeYouTubeEmbeds(parsed
        .replace(/width="[^"]*"/gi, '')
        .replace(/height="[^"]*"/gi, ''));
    } catch {
      return normalizeYouTubeEmbeds(rawContent);
    }
  }, [selectedProject]);
  const parsedDescriptionMarkup = useMemo(() => ({ __html: parsedDescriptionHtml }), [parsedDescriptionHtml]);

  const currentModalInstalledInfo = selectedProject ? getInstalledInfo(selectedProject.slug || selectedProject.id, selectedProject.title) : null;

  const activeCategoriesList = addonSource === 'curseforge'
    ? (CURSEFORGE_CATEGORIES[activeType] || CURSEFORGE_CATEGORIES.mod)
    : (ADDON_CATEGORIES[activeType] || ADDON_CATEGORIES.mod);

  return (
    <div className={`modpacks-view ${addonSource === 'curseforge' ? 'curseforge-theme' : ''}`} style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {installStatusMsg && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 99999,
            background: '#050508',
            border: `1px solid ${installStatusMsg.type === 'error' ? '#ff4444' : addonSource === 'curseforge' ? '#F16436' : '#00AF5C'}`,
            borderRadius: '8px',
            padding: '14px 20px',
            boxShadow: `0 0 25px ${installStatusMsg.type === 'error' ? 'rgba(255,68,68,0.4)' : addonSource === 'curseforge' ? 'rgba(241,100,54,0.35)' : 'rgba(0,175,92,0.35)'}`,
            maxWidth: '380px',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 900, fontSize: '0.82rem', color: installStatusMsg.type === 'error' ? '#ff4444' : addonSource === 'curseforge' ? '#F16436' : '#00AF5C' }}>
              {installStatusMsg.title}
            </span>
          </div>
          <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.8)', lineHeight: 1.4 }}>
            {installStatusMsg.desc}
          </div>
        </div>
      )}

      <div className="view-header-unified source-tabs-wrapper">
        
        <div className="view-header-left" style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 className="view-header-title">Catálogo de Addons</h1>
            {totalHits > 0 && (
              <span className="dynamic-count-badge">
                {totalHits.toLocaleString()} DISPONIBLES
              </span>
            )}
          </div>
          <p className="view-header-subtitle">Enriquece tus instancias con mods, shaders, paquetes de texturas y datapacks.</p>
        </div>

        <div className="view-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAllFilters}
              style={{
                padding: '5px 10px',
                borderRadius: '8px',
                background: 'rgba(255, 0, 51, 0.1)',
                border: '1px solid rgba(255, 0, 51, 0.3)',
                color: '#ff4d6d',
                fontSize: '0.75rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
              title="Limpiar todos los filtros"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              <span>Limpiar</span>
            </button>
          )}

          <div
            className="source-tabs-capsule"
            style={{
              padding: '3px',
              gap: '3px',
              background: 'rgba(10, 10, 16, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <button
              className={`source-tab-btn modrinth ${addonSource === 'modrinth' ? 'active' : ''}`}
              onClick={() => { setAddonSource('modrinth'); setSelectedCategories([]); setOffset(0); }}
              title="Explorar addons en Modrinth"
              style={{ padding: '4px 10px', fontSize: '0.78rem', gap: '6px' }}
            >
              <img src="/Modrith.png" alt="Modrinth" style={{ width: '15px', height: '15px', objectFit: 'contain' }} />
              <span>Modrinth</span>
            </button>
            <button
              className={`source-tab-btn curseforge ${addonSource === 'curseforge' ? 'active' : ''}`}
              onClick={() => { setAddonSource('curseforge'); setSelectedCategories([]); setOffset(0); }}
              title="Explorar addons en CurseForge"
              style={{ padding: '4px 10px', fontSize: '0.78rem', gap: '6px' }}
            >
              <img src="/Curseforge.png" alt="CurseForge" style={{ width: '15px', height: '15px', objectFit: 'contain' }} />
              <span>CurseForge</span>
            </button>
          </div>

          <div style={{ width: '1px', height: '22px', background: 'rgba(255, 255, 255, 0.12)', margin: '0 2px' }} />

          <div
            className="source-tabs-capsule"
            style={{
              padding: '3px',
              gap: '3px',
              background: 'rgba(10, 10, 16, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            {[
              { id: 'mod', label: 'Mods' },
              { id: 'shader', label: 'Shaders' },
              { id: 'resourcepack', label: 'Texturas' },
              { id: 'datapack', label: 'Datapacks' },
            ].map((t) => (
              <button
                key={t.id}
                className={`source-tab-btn ${addonSource === 'curseforge' ? 'curseforge' : 'modrinth'} ${activeType === t.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveType(t.id as any);
                  setSelectedCategories([]);
                  setOffset(0);
                }}
                title={`Explorar ${t.label}`}
                style={{ padding: '4px 12px', fontSize: '0.78rem' }}
              >
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          {onClose && (
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#888', fontSize: '1.2rem', cursor: 'pointer', padding: '4px 8px' }}
              title="Cerrar catálogo"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="discover-layout">
        
        <div className="discover-main">
          
          <div className="discover-control-strip">

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 14px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '10px',
                gap: '12px',
                flexWrap: 'wrap'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    flexShrink: 0,
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                  }}
                >
                  <img
                    src={getInstanceIcon(selectedInst)}
                    alt={selectedInst?.name || 'Instancia'}
                    style={{ width: '22px', height: '22px', objectFit: 'contain' }}
                    onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }}
                  />
                </div>

                <div>
                  <div style={{ fontSize: '0.62rem', fontFamily: 'Orbitron, sans-serif', fontWeight: 800, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.5px' }}>
                    INSTALANDO EN:
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <select
                      value={selectedInstId}
                      onChange={(e) => {
                        inventoryRequestId.current += 1;
                        setInstalledInventoryReady(false);
                        setInstalledMods([]);
                        setInstalledShaders([]);
                        setInstalledResourcePacks([]);
                        setSelectedInstId(e.target.value);
                        setOffset(0);
                      }}
                      style={{
                        background: '#121218',
                        color: '#ffffff',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '0.88rem',
                        fontFamily: 'Rajdhani, sans-serif',
                        fontWeight: 800,
                        cursor: 'pointer',
                        outline: 'none'
                      }}
                    >
                      {installations.map((inst) => (
                        <option key={inst.id} value={inst.id} style={{ background: '#121218', color: '#fff' }}>
                          {inst.name} ({inst.type || 'Vanilla'} {inst.version})
                        </option>
                      ))}
                    </select>

                    {selectedInst && (
                      <span
                        style={{
                          fontSize: '0.7rem',
                          fontFamily: 'Orbitron, sans-serif',
                          background: addonSource === 'curseforge' ? 'rgba(241, 100, 54, 0.15)' : 'rgba(0, 175, 92, 0.15)',
                          border: `1px solid ${addonSource === 'curseforge' ? 'rgba(241, 100, 54, 0.35)' : 'rgba(0, 175, 92, 0.35)'}`,
                          color: addonSource === 'curseforge' ? '#ff7b47' : '#00e575',
                          padding: '3px 8px',
                          borderRadius: '5px',
                          fontWeight: 900,
                          letterSpacing: '0.5px',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {targetLoader.toUpperCase()} {targetVersion}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {onOpenFolder && selectedInst && (
                <button
                  type="button"
                  onClick={() => onOpenFolder(selectedInst.gameDirectory || '')}
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#ffffff',
                    padding: '5px 12px',
                    borderRadius: '7px',
                    fontSize: '0.75rem',
                    fontFamily: 'Rajdhani, sans-serif',
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'all 0.2s ease',
                    whiteSpace: 'nowrap'
                  }}
                  title="Abrir carpeta de juego de esta instancia"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                  <span>Abrir Carpeta</span>
                </button>
              )}
            </div>

            <div className="discover-search-bar">
              <span className="discover-search-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              </span>
              <input
                type="text"
                placeholder={`Buscar en ${activeType === 'mod' ? 'mods (Sodium, Iris, JEI...)' : activeType === 'shader' ? 'shaders (BSL, Complementary...)' : 'texturas o datapacks'} en ${addonSource === 'curseforge' ? 'CurseForge' : 'Modrinth'}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="discover-clear-btn" onClick={() => setSearchQuery('')} title="Borrar búsqueda">✕</button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div className="quick-loader-strip">
                {[
                  { name: 'all', label: 'Todos' },
                  { name: 'Fabric', label: 'Fabric', icon: '/Fabric.png', color: '#dbd1b4' },
                  { name: 'NeoForge', label: 'NeoForge', icon: '/Neoforge.png', color: '#ff7b00' },
                  { name: 'Forge', label: 'Forge', icon: '/Forge.png', color: '#8faecc' },
                  { name: 'Quilt', label: 'Quilt', icon: '/quilt.png', color: '#be99be' }
                ].map(l => {
                  const isAll = l.name === 'all';
                  const isSelected = isAll ? selectedLoaders.length === 0 : selectedLoaders.includes(l.name);
                  return (
                    <button
                      key={l.name}
                      type="button"
                      className={`quick-loader-pill ${isSelected ? 'active' : ''}`}
                      style={isSelected && !isAll ? { borderColor: l.color, color: l.color, boxShadow: `0 0 12px ${l.color}44, 0 4px 12px rgba(0,0,0,0.4)` } : {}}
                      onClick={() => {
                        if (isAll) {
                          setSelectedLoaders([]);
                        } else {
                          setSelectedLoaders(prev => prev.includes(l.name) ? prev.filter(x => x !== l.name) : [...prev, l.name]);
                        }
                        setOffset(0);
                      }}
                    >
                      {l.icon && <img src={l.icon} alt={l.label} style={{ width: '15px', height: '15px', objectFit: 'contain' }} />}
                      <span>{l.label}</span>
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setFilterByInstance(!filterByInstance);
                    setOffset(0);
                  }}
                  className={`quick-loader-pill ${filterByInstance ? 'active' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    borderColor: filterByInstance ? (addonSource === 'curseforge' ? '#F16436' : '#00AF5C') : 'rgba(255,255,255,0.1)',
                    color: filterByInstance ? (addonSource === 'curseforge' ? '#F16436' : '#00AF5C') : 'inherit',
                    boxShadow: filterByInstance ? `0 0 12px ${addonSource === 'curseforge' ? 'rgba(241,100,54,0.3)' : 'rgba(0,175,92,0.3)'}` : 'none'
                  }}
                  title="Filtrar automáticamente por versión y loader de la instancia seleccionada"
                >
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: filterByInstance ? (addonSource === 'curseforge' ? '#F16436' : '#00AF5C') : 'rgba(255,255,255,0.2)',
                      boxShadow: filterByInstance ? `0 0 6px ${addonSource === 'curseforge' ? '#F16436' : '#00AF5C'}` : 'none'
                    }}
                  />
                  <span>COMPATIBLES</span>
                </button>

                <select
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value as any);
                    setOffset(0);
                  }}
                  style={{
                    background: '#141520',
                    color: '#ffffff',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '8px',
                    padding: '6px 12px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    fontFamily: 'Rajdhani, sans-serif',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  <option value="downloads">Más Descargados</option>
                  <option value="relevance">Relevancia</option>
                  <option value="follows">Más Seguidores</option>
                  <option value="updated">Recién Actualizados</option>
                  <option value="newest">Novedades</option>
                </select>
              </div>
            </div>
          </div>

          <div className="discover-list custom-scrollbar">
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[1, 2, 3, 4, 5, 6].map(n => (
                  <div key={n} className="discover-skeleton-card"></div>
                ))}
              </div>
            ) : results.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '50px', color: 'var(--text-secondary, #8e8e9f)' }}>
                <p style={{ fontSize: '1rem', fontWeight: 700, color: '#ffffff' }}>No se encontraron addons</p>
                <p style={{ fontSize: '0.85rem' }}>Intenta ajustar tus términos de búsqueda o filtros seleccionados.</p>
                {filterByInstance && (
                  <button
                    onClick={() => { setFilterByInstance(false); setOffset(0); }}
                    className="discover-install-btn"
                    style={{ marginTop: '12px', display: 'inline-block' }}
                  >
                    Desactivar filtro de compatibilidad de instancia
                  </button>
                )}
              </div>
            ) : (
              results.map((p) => {
                const isInstallingThis = installingProjectIds.has(p.project_id);
                const installedInfo = getInstalledInfo(p.slug || p.project_id, p.title);
                const isCF = p.source === 'curseforge';

                return (
                  <div 
                    className="discover-card" 
                    key={p.project_id}
                    onClick={() => openProjectDetails(p.project_id, p.source)}
                  >
                    <img 
                      src={p.icon_url || '/logo.png'} 
                      alt={p.title} 
                      className="discover-icon"
                      onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }}
                    />
                    
                    <div className="discover-info">
                      <div className="discover-header">
                        <h3 className="discover-title" title={p.title}>{p.title}</h3>
                        <span className="discover-author">por {p.author}</span>
                        
                        {isCF && (
                          <span
                            style={{
                              fontSize: '0.58rem',
                              fontFamily: 'Orbitron, sans-serif',
                              fontWeight: 900,
                              color: '#F16436',
                              background: 'rgba(241, 100, 54, 0.12)',
                              border: '1px solid rgba(241, 100, 54, 0.3)',
                              padding: '2px 5px',
                              borderRadius: '4px',
                              flexShrink: 0
                            }}
                          >
                            CURSEFORGE
                          </span>
                        )}

                        {installedInfo.isInstalled && (
                          <span
                            style={{
                              fontSize: '0.62rem',
                              fontFamily: 'Orbitron, sans-serif',
                              fontWeight: 900,
                              color: '#000000',
                              background: '#ffffff',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              flexShrink: 0,
                              boxShadow: '0 0 8px rgba(255,255,255,0.4)'
                            }}
                          >
                            INSTALADO
                          </span>
                        )}
                      </div>
                      <p className="discover-desc" title={p.description}>{p.description}</p>
                      <div className="discover-tags">
                        {p.categories && p.categories.slice(0, 3).map((tag: string) => (
                          <span className="discover-tag" key={tag}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.75 }}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path></svg>
                            {tag}
                          </span>
                        ))}
                        {p.categories && p.categories.length > 3 && (
                          <span className="discover-tag-more">+{p.categories.length - 3}</span>
                        )}
                      </div>
                    </div>

                    <div className="discover-actions">
                      <div className="discover-stats">
                        {p.downloads !== undefined && p.downloads !== null && (
                          <div className="discover-stat" title="Descargas">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            <span>{formatNumber(p.downloads)}</span>
                          </div>
                        )}
                        {p.follows !== undefined && p.follows !== null && (
                          <div className="discover-stat" title="Seguidores / Votos">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                            </svg>
                            <span>{formatNumber(p.follows)}</span>
                          </div>
                        )}
                      </div>
                      <button 
                        className="discover-install-btn"
                        disabled={!installedInventoryReady || isInstallingThis}
                        style={installedInfo.isInstalled ? { background: 'rgba(255,255,255,0.08)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.3)', boxShadow: 'none' } : {}}
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          handleInstallAddon(p.project_id, undefined, p.title, installedInfo.filename, p.source); 
                        }}
                      >
                        {!installedInventoryReady ? 'COMPROBANDO...' : isInstallingThis ? 'DESCARGANDO...' : installedInfo.isInstalled ? 'REINSTALAR' : '+ INSTALAR'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {totalHits > PAGE_LIMIT && (
            <div className="pagination-bar">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(prev => Math.max(0, prev - PAGE_LIMIT))}
                className="pag-btn"
              >
                &laquo;
              </button>

              {(() => {
                const startPage = Math.max(1, currentPage - 2);
                const endPage = Math.min(totalPages, startPage + 4);
                const pages = [];
                for (let i = startPage; i <= endPage; i++) {
                  pages.push(
                    <button
                      key={i}
                      className={`pag-btn ${currentPage === i ? 'active' : ''}`}
                      onClick={() => setOffset((i - 1) * PAGE_LIMIT)}
                    >
                      {i}
                    </button>
                  );
                }
                return pages;
              })()}

              <button
                disabled={currentPage >= totalPages}
                onClick={() => setOffset(prev => prev + PAGE_LIMIT)}
                className="pag-btn"
              >
                &raquo;
              </button>
            </div>
          )}

        </div>

        <aside className="discover-sidebar custom-scrollbar">
          
          <div className="sidebar-section">
            <div className="sidebar-header" onClick={() => toggleSection('categories')}>
              <span>Categorías ({addonSource === 'curseforge' ? 'CurseForge' : 'Modrinth'})</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expandedSections.includes('categories') ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
            {expandedSections.includes('categories') && (
              <div className="sidebar-list custom-scrollbar">
                {activeCategoriesList.map((cat: any) => {
                  const catKey = cat.name || cat.id;
                  return (
                    <label className="sidebar-item" key={cat.id}>
                      <input 
                        type="checkbox" 
                        style={{ accentColor: addonSource === 'curseforge' ? '#F16436' : '#00AF5C' }} 
                        checked={selectedCategories.includes(catKey)}
                        onChange={() => {
                          setSelectedCategories(prev => prev.includes(catKey) ? prev.filter(c => c !== catKey) : [...prev, catKey]);
                          setOffset(0);
                        }}
                      />
                      <span>{cat.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="sidebar-section">
            <div className="sidebar-header" onClick={() => toggleSection('game_version')}>
              <span>Versión del juego</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expandedSections.includes('game_version') ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
            {expandedSections.includes('game_version') && (
              <div className="sidebar-list custom-scrollbar">
                <div className="discover-search-bar" style={{ marginBottom: '6px' }}>
                  <input 
                    type="text" 
                    placeholder="Buscar versión..." 
                    style={{ height: '32px', fontSize: '0.78rem', paddingLeft: '8px' }} 
                    value={versionSearch}
                    onChange={e => setVersionSearch(e.target.value)}
                  />
                </div>
                <div style={{ maxHeight: '140px', overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: '3px' }} className="custom-scrollbar">
                  {COMMON_MC_VERSIONS
                    .filter(v => v.includes(versionSearch))
                    .map(v => (
                    <label className="sidebar-item" key={v}>
                      <input 
                        type="checkbox" 
                        style={{ accentColor: addonSource === 'curseforge' ? '#F16436' : '#00AF5C' }} 
                        checked={selectedVersions.includes(v)}
                        onChange={() => {
                          setSelectedVersions(prev => prev.includes(v) ? prev.filter(ver => ver !== v) : [...prev, v]);
                          setOffset(0);
                        }}
                      /> 
                      <span>{v}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="sidebar-section">
            <div className="sidebar-header" onClick={() => toggleSection('loader')}>
              <span>Cargador</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expandedSections.includes('loader') ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
            {expandedSections.includes('loader') && (
              <div className="sidebar-list custom-scrollbar">
                {[
                  { name: 'Fabric', color: '#dbd1b4', icon: '/Fabric.png' },
                  { name: 'Forge', color: '#8faecc', icon: '/Forge.png' },
                  { name: 'NeoForge', color: '#ff7b00', icon: '/Neoforge.png' },
                  { name: 'Quilt', color: '#be99be', icon: '/quilt.png' }
                ].map(loader => (
                  <label className="sidebar-item" key={loader.name} style={{ color: loader.color }}>
                    <input 
                      type="checkbox" 
                      style={{ accentColor: addonSource === 'curseforge' ? '#F16436' : '#00AF5C' }} 
                      checked={selectedLoaders.includes(loader.name)}
                      onChange={() => {
                        setSelectedLoaders(prev => prev.includes(loader.name) ? prev.filter(l => l !== loader.name) : [...prev, loader.name]);
                        setOffset(0);
                      }}
                    /> 
                    <img src={loader.icon} alt={loader.name} style={{ width: '13px', height: '13px', objectFit: 'contain' }} />
                    <span>{loader.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

        </aside>

      </div>

      {projectLoading && createPortal(
        <div
          className="theme-dialog-overlay"
          data-theme={theme}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99995,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', color: '#ffffff' }}>
            <div style={{ width: '32px', height: '32px', border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--dialog-accent, #ffffff)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: '0.8rem', letterSpacing: '0.5px' }}>
              CARGANDO DETALLES DEL PROYECTO...
            </span>
          </div>
        </div>,
        document.body
      )}

      {selectedProject && createPortal(
        <div className="project-modal-overlay theme-dialog-overlay" data-theme={theme} onClick={() => setSelectedProject(null)}>
          <div className="project-modal-container theme-dialog-card" onClick={(e) => e.stopPropagation()}>
            
            <div className="project-modal-header">
              <button onClick={() => setSelectedProject(null)} className="project-modal-close" title="Cerrar">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>

              <div className="project-header-top">
                {selectedProject.icon_url ? (
                  <img src={selectedProject.icon_url} alt={selectedProject.title} className="project-header-icon" />
                ) : (
                  <div className="project-header-icon-fallback">
                    <span style={{ fontFamily: 'Orbitron', fontWeight: 900, fontSize: '1.4rem' }}>
                      {selectedProject.title.charAt(0)}
                    </span>
                  </div>
                )}

                <div className="project-header-info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
                    <h2 className="project-header-title" style={{ margin: 0 }}>
                      {selectedProject.title}
                    </h2>
                    
                    {selectedProject.source === 'curseforge' && (
                      <span style={{ fontSize: '0.62rem', fontFamily: 'Orbitron', fontWeight: 900, background: 'rgba(241, 100, 54, 0.15)', color: '#F16436', border: '1px solid rgba(241, 100, 54, 0.35)', padding: '2px 8px', borderRadius: '4px' }}>
                        CURSEFORGE
                      </span>
                    )}

                    {currentModalInstalledInfo?.isInstalled && (
                      <span style={{ fontSize: '0.65rem', fontFamily: 'Orbitron', fontWeight: 900, background: '#ffffff', color: '#000000', padding: '2px 8px', borderRadius: '4px', boxShadow: '0 0 8px rgba(255,255,255,0.4)' }}>
                        INSTALADO
                      </span>
                    )}
                  </div>

                  <div className="project-header-meta">
                    {selectedProject.categories?.map((cat: string) => (
                      <span key={cat} className="project-tag">
                        {cat}
                      </span>
                    ))}
                    {selectedProject.license && (
                      <span className="project-tag" style={{ borderColor: 'rgba(255,255,255,0.4)', color: '#ffffff' }}>
                        {selectedProject.license.id || selectedProject.license.name}
                      </span>
                    )}
                  </div>

                  <p className="project-header-desc">{selectedProject.description}</p>

                  <div className="project-header-stats">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      {formatNumber(selectedProject.downloads)} descargas
                    </span>

                    {selectedProject.followers !== undefined && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                        </svg>
                        {formatNumber(selectedProject.followers)} {selectedProject.source === 'curseforge' ? 'votos' : 'seguidores'}
                      </span>
                    )}

                    <span>CLIENTE: {selectedProject.client_side?.toUpperCase()}</span>
                    <span>SERVIDOR: {selectedProject.server_side?.toUpperCase()}</span>
                  </div>
                </div>

                <button
                  onClick={() => handleInstallAddon(selectedProject.id, undefined, selectedProject.title, currentModalInstalledInfo?.filename, selectedProject.source)}
                  disabled={!installedInventoryReady || installingProjectIds.has(selectedProject.id)}
                  className="project-install-btn"
                  style={currentModalInstalledInfo?.isInstalled ? { background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', boxShadow: 'none' } : {}}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                  {!installedInventoryReady ? 'COMPROBANDO...' : installingProjectIds.has(selectedProject.id) ? 'INSTALANDO...' : currentModalInstalledInfo?.isInstalled ? 'REINSTALAR' : '+ INSTALAR'}
                </button>
              </div>

              <div className="project-modal-tabs custom-scrollbar">
                <button
                  className={`project-modal-tab ${projectTab === 'description' ? 'active' : ''}`}
                  onClick={() => setProjectTab('description')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                  </svg>
                  Descripción
                </button>
                <button
                  className={`project-modal-tab ${projectTab === 'versions' ? 'active' : ''}`}
                  onClick={() => setProjectTab('versions')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                    <line x1="7" y1="7" x2="7.01" y2="7"></line>
                  </svg>
                  Versiones ({projectVersions.length})
                </button>
                {selectedProject.gallery && selectedProject.gallery.length > 0 && (
                  <button
                    className={`project-modal-tab ${projectTab === 'gallery' ? 'active' : ''}`}
                    onClick={() => setProjectTab('gallery')}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                      <circle cx="8.5" cy="8.5" r="1.5"></circle>
                      <polyline points="21 15 16 10 5 21"></polyline>
                    </svg>
                    Galería ({selectedProject.gallery.length})
                  </button>
                )}
              </div>
            </div>

            <div className="project-modal-body custom-scrollbar">
              
              {projectTab === 'description' && (
                <div>
                  <div
                    className="project-html-content custom-scrollbar"
                    dangerouslySetInnerHTML={parsedDescriptionMarkup}
                  />
                  {selectedProject.gallery && selectedProject.gallery.length > 0 && (
                    <div style={{ marginTop: '30px' }}>
                      <h4 style={{ fontFamily: 'Orbitron', fontSize: '0.9rem', marginBottom: '14px', color: '#ffffff' }}>CAPTURAS DESTACADAS</h4>
                      <div className="project-gallery-grid">
                        {selectedProject.gallery.slice(0, 6).map((img, idx) => (
                          <div key={idx} className="gallery-thumb-card" onClick={() => setActiveImageIndex(idx)}>
                            <img src={img.url} alt={img.title || 'Screenshot'} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {projectTab === 'versions' && (
                <div>
                  <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                    <div
                      onClick={() => {
                        const nextVal = !filterCompatibleVersions;
                        setFilterCompatibleVersions(nextVal);
                        if (selectedProject) {
                          if (selectedProject.source === 'curseforge') {
                            loadCurseForgeVersions(Number(selectedProject.id), nextVal);
                          } else {
                            loadProjectVersions(selectedProject.id, nextVal);
                          }
                        }
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        padding: '6px 14px',
                        background: filterCompatibleVersions ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                        border: `1px solid ${filterCompatibleVersions ? '#ffffff' : 'rgba(255, 255, 255, 0.15)'}`,
                        borderRadius: '20px',
                        transition: 'all 0.2s',
                        fontSize: '0.75rem',
                        fontFamily: 'Rajdhani, sans-serif',
                        fontWeight: 700,
                        color: filterCompatibleVersions ? '#ffffff' : '#a3a3a3'
                      }}
                    >
                      <span style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: filterCompatibleVersions ? '#ffffff' : 'transparent',
                        border: `1.5px solid ${filterCompatibleVersions ? '#ffffff' : '#a3a3a3'}`,
                        boxShadow: filterCompatibleVersions ? '0 0 8px #ffffff' : 'none'
                      }} />
                      <span>Solo versiones compatibles con {targetLoader.toUpperCase()} {targetVersion}</span>
                    </div>

                    <span style={{ fontSize: '0.72rem', color: '#888888', fontFamily: 'monospace' }}>
                      {projectVersions.length} {projectVersions.length === 1 ? 'versión' : 'versiones'} disponibles
                    </span>
                  </div>

                  {versionsLoading ? (
                    <div style={{ textAlign: 'center', padding: '50px', color: '#a3a3a3', fontFamily: 'Orbitron' }}>
                      <div style={{ width: '28px', height: '28px', border: '3px solid rgba(255,255,255,0.2)', borderTopColor: '#ffffff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px auto' }} />
                      Cargando lista de versiones...
                    </div>
                  ) : paginatedVersions.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '50px', background: '#0f0f14', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <p style={{ fontFamily: 'Orbitron', fontSize: '0.95rem', fontWeight: 700, color: '#ffffff' }}>No se encontraron versiones</p>
                      <p style={{ fontSize: '0.78rem', color: '#a3a3a3', marginTop: '4px' }}>
                        Prueba desactivando el filtro de compatibilidad para ver todas las versiones del mod.
                      </p>
                    </div>
                  ) : (
                    <div>
                      {paginatedVersions.map((ver) => {
                        const isThisInstalling = installingProjectIds.has(selectedProject.id);
                        const isExpanded = !!expandedChangelogs[ver.id];
                        const primaryFile = ver.files?.find((f: any) => f.primary) || ver.files?.[0];
                        const fileSizeMb = primaryFile && primaryFile.size > 0 ? (primaryFile.size / (1024 * 1024)).toFixed(2) : null;

                        return (
                          <div key={ver.id} className="version-card-item">
                            <div style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: 'Orbitron', fontWeight: 800, fontSize: '0.95rem', color: '#ffffff' }}>
                                  {ver.name || ver.version_number}
                                </span>
                                {ver.version_type && (
                                  <span style={{
                                    fontSize: '0.65rem',
                                    fontFamily: 'Orbitron',
                                    fontWeight: 900,
                                    background: ver.version_type.toLowerCase() === 'release' ? 'rgba(0, 255, 102, 0.15)' : ver.version_type.toLowerCase() === 'beta' ? 'rgba(255, 170, 0, 0.15)' : 'rgba(255, 0, 85, 0.15)',
                                    color: ver.version_type.toLowerCase() === 'release' ? '#00ff66' : ver.version_type.toLowerCase() === 'beta' ? '#ffaa00' : '#ff0055',
                                    border: `1px solid ${ver.version_type.toLowerCase() === 'release' ? 'rgba(0, 255, 102, 0.3)' : ver.version_type.toLowerCase() === 'beta' ? 'rgba(255, 170, 0, 0.3)' : 'rgba(255, 0, 85, 0.3)'}`,
                                    padding: '1px 7px',
                                    borderRadius: '4px'
                                  }}>
                                    {ver.version_type.toUpperCase()}
                                  </span>
                                )}
                                {ver.game_versions && ver.game_versions.length > 0 && (
                                  <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.1)', color: '#ffffff', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>
                                    MC {ver.game_versions.slice(0, 3).join(', ')}
                                  </span>
                                )}
                                {ver.loaders && ver.loaders.length > 0 && (
                                  <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.15)', color: '#ffffff', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace', textTransform: 'uppercase' }}>
                                    {ver.loaders.join(', ')}
                                  </span>
                                )}
                                {fileSizeMb && (
                                  <span style={{ fontSize: '0.7rem', color: '#888888', fontFamily: 'monospace' }}>
                                    {fileSizeMb} MB
                                  </span>
                                )}
                                {ver.date_published && (
                                  <span style={{ fontSize: '0.7rem', color: '#888888' }}>
                                    • {formatDate(ver.date_published)}
                                  </span>
                                )}
                              </div>

                              {ver.changelog && (
                                <div style={{ marginTop: '6px' }}>
                                  <div
                                    className="version-changelog-text custom-scrollbar"
                                    style={isExpanded ? { maxHeight: 'none', fontStyle: 'normal' } : {}}
                                  >
                                    {ver.changelog}
                                  </div>
                                  {ver.changelog.length > 120 && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedChangelogs(prev => ({ ...prev, [ver.id]: !prev[ver.id] }));
                                      }}
                                      style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'rgba(255,255,255,0.5)',
                                        fontSize: '0.7rem',
                                        cursor: 'pointer',
                                        padding: '2px 0',
                                        marginTop: '4px',
                                        fontFamily: 'Rajdhani',
                                        fontWeight: 600
                                      }}
                                    >
                                      {isExpanded ? '▲ Mostrar menos' : '▼ Ver cambios completos'}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            <button
                              onClick={() => handleInstallAddon(selectedProject.id, ver.id, `${selectedProject.title} ${ver.version_number}`, currentModalInstalledInfo?.filename, selectedProject.source)}
                              disabled={!installedInventoryReady || isThisInstalling}
                              className="version-btn-install"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                              </svg>
                              {!installedInventoryReady ? 'COMPROBANDO...' : isThisInstalling ? 'DESCARGANDO...' : 'INSTALAR ESTA VERSIÓN'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {totalVersionPages > 1 && (
                    <div className="modal-pagination">
                      <button
                        onClick={() => setVersionPage(p => Math.max(1, p - 1))}
                        disabled={versionPage === 1}
                        className="modal-pag-btn"
                      >
                        ‹
                      </button>
                      <span>PÁGINA {versionPage} DE {totalVersionPages}</span>
                      <button
                        onClick={() => setVersionPage(p => Math.min(totalVersionPages, p + 1))}
                        disabled={versionPage === totalVersionPages}
                        className="modal-pag-btn"
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>
              )}

              {projectTab === 'gallery' && selectedProject.gallery && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                  {selectedProject.gallery.map((img: any, idx: number) => (
                    <div
                      key={idx}
                      onClick={() => setActiveImageIndex(idx)}
                      style={{
                        background: '#0c0c11',
                        borderRadius: '14px',
                        overflow: 'hidden',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        cursor: 'pointer',
                        transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                        display: 'flex',
                        flexDirection: 'column',
                        position: 'relative'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#ffffff';
                        e.currentTarget.style.transform = 'translateY(-3px)';
                        e.currentTarget.style.boxShadow = '0 10px 25px rgba(0,0,0,0.8), 0 0 15px rgba(255,255,255,0.15)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                      title="Clic para ver en pantalla completa"
                    >
                      <div style={{ position: 'relative', width: '100%', height: '180px', background: '#050507', overflow: 'hidden' }}>
                        <img
                          src={img.url}
                          alt={img.title || `Captura ${idx + 1}`}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        <div style={{
                          position: 'absolute',
                          bottom: '8px',
                          right: '8px',
                          background: 'rgba(0, 0, 0, 0.75)',
                          backdropFilter: 'blur(6px)',
                          border: '1px solid rgba(255, 255, 255, 0.25)',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          color: '#ffffff',
                          fontFamily: 'Orbitron',
                          fontSize: '0.62rem',
                          fontWeight: 800
                        }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                          </svg>
                          <span>AMPLIAR</span>
                        </div>
                      </div>
                      {img.title && (
                        <p style={{ padding: '10px 14px', fontSize: '0.78rem', color: '#e0e0e0', fontWeight: 600, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                          {img.title}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

            </div>
          </div>
        </div>,
        document.body
      )}

      {activeImageIndex !== null && selectedProject?.gallery && createPortal(
        <div className="lightbox-overlay" onClick={() => setActiveImageIndex(null)}>
          <button className="lightbox-close" onClick={() => setActiveImageIndex(null)}>✕</button>
          <img
            src={selectedProject.gallery[activeImageIndex].url}
            alt="Fullscreen view"
            className="lightbox-image"
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}

    </div>
  );
}
