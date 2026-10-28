import React, { useState } from 'react';

interface LegalModalProps {
  onClose: () => void;
  initialTab?: 'terms' | 'privacy';
}

const LegalModal: React.FC<LegalModalProps> = ({ onClose, initialTab = 'terms' }) => {
  const [activeTab, setActiveTab] = useState<'terms' | 'privacy'>(initialTab);

  return (
    <div className="legal-modal-overlay">
      <div className="legal-modal-container">
        <div className="legal-modal-header">
          <div className="legal-tabs">
            <button 
              className={`legal-tab ${activeTab === 'terms' ? 'active' : ''}`}
              onClick={() => setActiveTab('terms')}
            >
              Términos de Servicio
            </button>
            <button 
              className={`legal-tab ${activeTab === 'privacy' ? 'active' : ''}`}
              onClick={() => setActiveTab('privacy')}
            >
              Política de Privacidad
            </button>
          </div>
          <button className="legal-close-btn" onClick={onClose}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="legal-modal-content custom-scrollbar">
          {activeTab === 'terms' && (
            <div className="legal-text-section">
              <h2>Términos de Servicio y Condiciones de Uso · Borrador</h2>
              <p className="legal-last-updated">Borrador inicial: 23 de octubre de 2026</p>
              
              <h3>1. Aceptación de los Términos</h3>
              <p>Al acceder, instalar o utilizar <strong>NavithLabs Launcher</strong> ("el Software"), usted acepta estos Términos de Servicio. Si no está de acuerdo con alguna parte de estos términos, no debe utilizar el Software.</p>

              <h3>2. Ausencia de Afiliación Oficial</h3>
              <p><strong>IMPORTANTE:</strong> NavithLabs Launcher <strong>no es un producto oficial de Minecraft</strong> ni está aprobado o asociado con Mojang AB o Microsoft Corporation. "Minecraft" es una marca comercial de sus respectivos titulares.</p>

              <h3>3. Cumplimiento del EULA de Minecraft y Anti-Piratería</h3>
              <p>Este Software es una herramienta independiente desarrollada para gestionar instancias locales, entornos de desarrollo, modding y personalización estética. <br/><br/>
              <strong>Nosotros NO apoyamos, facilitamos ni promovemos la piratería.</strong> Para utilizar funciones en línea o acceder a servidores oficiales y verificados, <strong>debe poseer una cuenta de Minecraft legal y legítimamente adquirida</strong>.<br/><br/>
              El modo "Offline" integrado está estrictamente diseñado para desarrolladores de mods que necesitan probar entornos locales, o para partidas en redes de área local (LAN) cerradas y privadas. Al usar este Software, usted acepta cumplir enteramente con el <strong>End User License Agreement (EULA)</strong> oficial de Mojang.</p>

              <h3>4. Sincronización de Perfiles de Minecraft, Skins y Capas Oficiales</h3>
              <p>El Software incluye un gestor interactivo 3D para la consulta, selección y sincronización en tiempo real de aspectos (skins) y capas oficiales reclamadas a través de la API oficial de Microsoft (<code>api.minecraftservices.com</code>).<br/><br/>
              - <strong>Uso de la API Oficial:</strong> La modificación de skins y equipamiento de capas se realiza consumiendo de forma directa los endpoints oficiales de Mojang.<br/>
              - <strong>Responsabilidad sobre Skins:</strong> Usted es el único responsable del contenido de los archivos de imagen (.png) o URLs de skins que decida subir o guardar en su biblioteca. Queda estrictamente prohibido el uso de skins con contenido discriminatorio, ofensivo o que viole derechos de propiedad intelectual.<br/>
              - <strong>Límites y Cooldowns:</strong> El Software implementa controles temporales para respetar la tasa de peticiones (rate limiting) impuesta por las APIs de Microsoft.</p>

              <h3>5. Términos de Cargadores de Mods y Plataformas de Terceros</h3>
              <p>NavithLabs Launcher automatiza la búsqueda, descarga e instalación de cargadores de mods (Mod Loaders) y modpacks de terceros, incluyendo, pero no limitado a: <strong>Minecraft Forge, NeoForge, Fabric, Quilt, CurseForge y Modrinth</strong>.<br/><br/>
              Al utilizar estas herramientas a través de nuestro launcher, usted acepta que dichos cargadores y contenidos están sujetos a sus propias licencias de código abierto y términos de servicio de sus respectivos creadores. Nosotros no reclamamos propiedad intelectual sobre estos cargadores, sus APIs ni sus marcas. Actuamos únicamente como un puente facilitador de instalación local.</p>

              <h3>6. Descarga de Runtimes de Java (JRE/JDK)</h3>
              <p>Para garantizar el correcto funcionamiento del juego en diferentes versiones de Minecraft, el Software puede descargar e instalar automáticamente entornos de ejecución de Java de código abierto (tales como Adoptium Eclipse Temurin u otros distribuidores oficiales). Estos entornos se distribuyen bajo sus propias licencias de código abierto (como GPLv2 con Classpath Exception).</p>

              <h3>7. Eventos Comunitarios y Estado de Servidores (NavithLabs Live Pulse)</h3>
              <p>El Software puede integrar accesos directos, estadísticas en tiempo real y la instalación automática de modpacks para eventos comunitarios especiales y servidores integrados. La disponibilidad, estabilidad e historial de dichos servidores externos dependen exclusivamente de sus administradores, por lo que no garantizamos su funcionamiento ininterrumpido.</p>

              <h3>8. Propósito de la Herramienta</h3>
              <p>NavithLabs Launcher se provee "tal cual" (AS IS) sin garantías explícitas ni implícitas de comerciabilidad o idoneidad para un propósito particular. Esta herramienta ha sido creada para mejorar y simplificar la experiencia de gestión de mods, aspectos y múltiples instancias de Minecraft.</p>

              <h3>9. Eliminación de Instancias y Gestión de Disco</h3>
              <p>La función de eliminación de instancias en el launcher realiza un borrado permanente y seguro en el sistema de archivos local. Es responsabilidad exclusiva del usuario respaldar sus mundos guardados (savegames), capturas de pantalla (screenshots) o archivos personales antes de proceder a la eliminación de cualquier instancia.</p>

              <h3>10. Limitación de Responsabilidad e Indemnización</h3>
              <p>En la máxima medida permitida por la ley aplicable, <strong>los desarrolladores y creadores de NavithLabs Launcher no serán responsables</strong> por ningún daño directo, indirecto, incidental, especial, consecuente o punitivo. Esto incluye, pero no se limita a:<br/>
              - Pérdida de datos, corrupción de mundos guardados o pérdida de configuraciones.<br/>
              - Daños al hardware o fallos del sistema operativo por una asignación de recursos extrema (ej. asignar demasiada memoria RAM).<br/>
              - <strong>Baneos o suspensiones de cuentas</strong> en servidores multijugador oficiales o privados por el uso de modificaciones (mods) instaladas a través de este gestor.<br/>
              Usted acepta mantener indemne a los creadores frente a cualquier reclamación legal derivada de su uso de la herramienta.</p>

              <h3>11. Discord Rich Presence</h3>
              <p>El Software incluye una integración opcional con Discord Rich Presence para mostrar su actividad actual (instancia seleccionada, estado de carga o versión en juego) en su perfil de Discord. Esta comunicación es local y se realiza directamente con su cliente de Discord instalado.</p>

              <h3>12. Modificaciones a los Términos</h3>
              <p>Nos reservamos el derecho de modificar estos Términos de Servicio en cualquier momento para reflejar actualizaciones en el Software, cambios legales o políticas impuestas por Mojang/Microsoft. Es su responsabilidad revisar estos términos periódicamente.</p>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div className="legal-text-section">
              <h2>Política de Privacidad · Borrador</h2>
              <p className="legal-last-updated">Borrador inicial: 23 de octubre de 2026</p>
              
              <h3>1. Información Recopilada y Almacenamiento Local</h3>
              <p>El launcher guarda localmente las cuentas, preferencias, perfiles y rutas del juego en los datos de la aplicación y en <code>localStorage</code>. Las credenciales de Microsoft, Discord y Google se procesan para autenticar la cuenta y no se envían al servicio opcional de NavithLabs.</p>
              <ul>
                <li><strong>Nombres de usuario e Identificadores:</strong> Utilizados únicamente para iniciar sesión en sus perfiles (Premium o Locales).</li>
                <li><strong>Biblioteca Personal de Skins:</strong> Las skins guardadas en su colección se almacenan localmente en su propio navegador/dispositivo.</li>
                <li><strong>Configuraciones de Sistema:</strong> Asignación de memoria RAM, argumentos JVM, preferencias de sonido y rutas de instalación de Java (JRE/JDK).</li>
                <li><strong>Estructura de Archivos:</strong> Directorios de instalación de instancias, listas de mods, texturas y configuraciones del juego.</li>
                <li><strong>Diagnósticos:</strong> Logs de consola y Crash Reports generados por el juego. Estos archivos son para su propio uso diagnóstico y <strong>nunca se suben automáticamente</strong> a ninguna plataforma externa.</li>
              </ul>

              <h3>2. Servicio opcional de NavithLabs</h3>
              <p>Si se configura una API de NavithLabs, el launcher puede enviar un identificador aleatorio de instalación y señales de actividad para contar instalaciones y sesiones activas. Estas solicitudes no incluyen el nombre de usuario ni los tokens de autenticación. El servicio que aloja la API puede recibir los metadatos normales de conexión, incluida la dirección IP. Sin una API configurada, estas funciones quedan inactivas.</p>

              <h3>3. Autenticación con Servicios de Terceros (Microsoft, Discord, Google)</h3>
              <p>Si decide iniciar sesión mediante servicios de <strong>Microsoft, Discord o Google</strong>, el Software procesa la respuesta de autenticación y puede guardar los datos y tokens de acceso recibidos de forma local. La autenticación se completa con los servicios oficiales correspondientes; no se envían esos tokens a la API opcional de NavithLabs.
              <br/><br/>
              - <strong>Sincronización de Skins y Capas Mojang:</strong> La comunicación con la API de <code>api.minecraftservices.com</code> se realiza exclusivamente usando los tokens oficiales obtenidos durante la autenticación de Microsoft.<br/>
              - <strong>Discord:</strong> Al iniciar sesión con Discord, accedemos a su información básica de perfil (nombre, avatar y banner) para personalizar su experiencia en el launcher.</p>

              <h3>4. Consultas de Estado en Tiempo Real (Live Pulse y Servidores)</h3>
              <p>Para consultar el estado de un servidor, el launcher envía su dirección a un proveedor de consulta de estado. Los anuncios y eventos solo se cargan cuando hay una API de NavithLabs configurada. Los proveedores reciben los datos técnicos normales de esas solicitudes; no se incluyen credenciales de autenticación.</p>

              <h3>5. Discord Rich Presence y Visibilidad</h3>
              <p>La presencia enriquecida de Discord es opcional y viene desactivada inicialmente. Si la activa, el launcher comunica el estado de juego y la instancia actual al cliente local de Discord. Puede desactivarla desde la configuración del launcher.</p>

              <h3>6. Gestión de Mods y Contenido Descargado</h3>
              <p>Al utilizar las funciones de instalación de mods, el Software se conecta directamente a repositorios públicos de terceros (como CurseForge o Modrinth). <strong>No registramos qué mods descarga, qué versiones juega o qué servidores visita.</strong> Su historial de juego es estrictamente confidencial y reside en su disco duro.</p>

              <h3>7. Consentimiento de Acceso a Archivos Locales</h3>
              <p>El launcher lee y escribe en las carpetas de juego y Java que usted elija, además de su carpeta de datos local. Puede seleccionar otras ubicaciones para instalar instancias o Java. Revise la carpeta seleccionada antes de instalar o eliminar archivos.</p>

              <h3>8. Eliminación y Destrucción de Datos</h3>
              <p>Puede borrar los perfiles, tokens locales y configuraciones eliminando los datos locales de la aplicación. Desinstalar el programa puede no eliminar esos datos automáticamente. Si se habilita una API de NavithLabs, el tratamiento y el periodo de conservación del identificador aleatorio deberán describirse según la configuración del servicio publicado.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LegalModal;
