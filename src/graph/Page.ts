import { TFile } from "obsidian";
import { getFileInfo } from "prettier";
import ExcaliBrain from "src/main";
import { ExcaliBrainSettings } from "src/Settings";
import { LinkDirection, Neighbour, Relation, RelationType } from "src/Types";
import { getFilenameFromPath } from "src/utils/fileUtils";

const DEFAULT_RELATION:Relation = {
  target: null,
  isParent: false,
  isChild: false,
  isFriend: false,
  direction: null
}

const getRelationVector = (r:Relation):{
  pi: boolean,
  pd: boolean,
  ci: boolean,
  cd: boolean,
  fd: boolean
} => {
  return {
    pi: r.isParent && r.parentType === RelationType.INFERRED,
    pd: r.isParent && r.parentType === RelationType.DEFINED,
    ci: r.isChild && r.childType === RelationType.INFERRED,
    cd: r.isChild && r.childType === RelationType.DEFINED,
    fd: r.isFriend
  }
}

const concat = (s1: string, s2: string): string => {
  return s1 && s2 
    ? (s1 +", " + s2)
    : s1 
      ? s1
      : s2
}

const directionToSet = (currentDirection:LinkDirection, newDirection: LinkDirection):LinkDirection => {
  if(!currentDirection) {
    return newDirection;
  }
  if(currentDirection === LinkDirection.BOTH || currentDirection === newDirection) {
    return currentDirection;
  }
  return LinkDirection.BOTH;
}

const relationTypeToSet = (currentType: RelationType, newType: RelationType):RelationType => {
  if(currentType === RelationType.DEFINED) {
    return RelationType.DEFINED
  }
  if(currentType === RelationType.INFERRED) {
    if(newType === RelationType.DEFINED) {
      return RelationType.DEFINED;
    }
    return RelationType.INFERRED;
  }
  return newType;
}

export class Page {
  public mtime: number;
  public neighbours: Map<string,Relation>;
  public settings: ExcaliBrainSettings;
  public dvPage: Record<string, any>;
  
  constructor(
    public path:string,
    public file:TFile,
    public plugin: ExcaliBrain,
    public isFolder: boolean=false,
    public isTag: boolean=false,
    public name?: string
  ) {
    if(!name) {
      this.name = file 
      ? (file.extension === "md")
        ? file.basename
        : file.name
      : getFilenameFromPath(path);
    }
    this.mtime = file ? file.stat.mtime : null;
    this.neighbours = new Map<string,Relation>();
    this.settings = plugin.settings;
  }

  public getTitle(): string {
    const aliases = (this.file && this.plugin.settings.renderAlias)
      ? (this.dvPage?.file?.aliases?.values??[])
      : [];
    return aliases.length > 0 
      ? aliases[0] 
      : this.name
  }

  private getNeighbours(): [string, Relation][] {
    const { showVirtualNodes, showAttachments, showFolderNodes, showTagNodes, showPageNodes } = this.settings
    return Array.from(this.neighbours)
      .filter(x=> (showVirtualNodes || !x[1].target.isVirtual) && 
        (showAttachments || !x[1].target.isAttachment) &&
        (showFolderNodes || !x[1].target.isFolder) &&
        (showTagNodes || !x[1].target.isTag) &&
        (showPageNodes || x[1].target.isFolder || x[1].target.isTag)
        )
  }
  
  public get isVirtual(): boolean {
    return (this.file === null) && !this.isFolder && !this.isTag;
  }

  public get isAttachment(): boolean {
    return this.file ? (this.file.extension !== "md") : false;
  }

  public get isMarkdown(): boolean {
    //files that have not been created are assumed to be markdown files
    return this.file?.extension === "md" || !this.file;
  }

  //-----------------------------------------------
  // add relationships
  //-----------------------------------------------
  addParent(page: Page, relationType:RelationType,  direction: LinkDirection, definition?: string) {
    if(page.path === this.plugin.settings.excalibrainFilepath) {
      return;
    };
    const neighbour = this.neighbours.get(page.path);
    if(neighbour) {
      neighbour.isParent = true;
      neighbour.parentType = relationTypeToSet(neighbour.parentType,relationType);
      neighbour.parentTypeDefinition = concat(definition, neighbour.parentTypeDefinition);
      neighbour.direction = directionToSet(neighbour.direction, direction);
      return;
    }
    this.neighbours.set(page.path, {
      ...DEFAULT_RELATION,
      target: page,
      isParent: true,
      parentType: relationType,
      parentTypeDefinition: definition,
      direction
    });
  }

  addChild(page: Page, relationType:RelationType, direction: LinkDirection, definition?: string) {
    if(page.path === this.plugin.settings.excalibrainFilepath) {
      return;
    };
    const neighbour = this.neighbours.get(page.path);
    if(neighbour) {
      neighbour.isChild = true;
      neighbour.childType = relationTypeToSet(neighbour.childType,relationType);
      neighbour.childTypeDefinition = concat(definition,neighbour.childTypeDefinition);
      neighbour.direction = directionToSet(neighbour.direction, direction);
      return;
    }
    this.neighbours.set(page.path, {
      ...DEFAULT_RELATION,
      target: page,
      isChild: true,
      childType: relationType,
      childTypeDefinition: definition,
      direction
    });
  }

  addFriend(page: Page, relationType:RelationType, direction: LinkDirection, definition?: string) {
    if(page.path === this.plugin.settings.excalibrainFilepath) {
      return;
    };
    const neighbour = this.neighbours.get(page.path);
    if(neighbour) {
      neighbour.isFriend = true;
      neighbour.friendType = relationTypeToSet(neighbour.friendType,relationType);
      neighbour.friendTypeDefinition = concat(definition,neighbour.friendTypeDefinition);
      neighbour.direction = directionToSet(neighbour.direction, direction);
      return;
    }
    this.neighbours.set(page.path, {
      ...DEFAULT_RELATION,
      target: page,
      isFriend: true,
      friendType: relationType,
      friendTypeDefinition: definition,
      direction
    });
  }
  
  unlinkNeighbour(pagePath: string) {
    this.neighbours.delete(pagePath);
  }

  //-----------------------------------------------
  //see: getRelationLogic.excalidraw
  //-----------------------------------------------
  isChild = (relation: Relation):RelationType => {
    const {pi,pd,ci,cd,fd} = getRelationVector(relation);
    return (cd && !pd && !fd) 
      ? RelationType.DEFINED 
      : (!pi && !pd && ci && !cd && !fd)
        ? RelationType.INFERRED
        : null;
  };

  hasChildren ():boolean {
    return this.getNeighbours()
    .some(x => {
      const rt = this.isChild(x[1]);
      return (rt && this.settings.showInferredNodes) || (rt === RelationType.DEFINED);
    });
  }

  getChildren():Neighbour[] {
    return this.getNeighbours()
      .filter(x => {
        const rt = this.isChild(x[1]);
        return (rt && this.settings.showInferredNodes) || (rt === RelationType.DEFINED);
      }).map(x=>{
        return {
          page: x[1].target,
          relationType: x[1].childType,
          typeDefinition: x[1].childTypeDefinition,
          linkDirection: x[1].direction
        }
      });//.sort
  }

  isParent (relation: Relation):RelationType {
    const {pi,pd,ci,cd,fd} = getRelationVector(relation);
    return (!cd && pd && !fd) 
      ? RelationType.DEFINED 
      : (pi && !pd && !ci && !cd && !fd)
        ? RelationType.INFERRED
        : null;
  }
  

  hasParents():boolean { 
    return this.getNeighbours()
    .some(x => {
      const rt = this.isParent(x[1]);
      return (rt && this.settings.showInferredNodes) || (rt === RelationType.DEFINED);
    });
  }

  getParents():Neighbour[] {
    return this.getNeighbours()
    .filter(x => {
      const rt = this.isParent(x[1]);
      return (rt && this.settings.showInferredNodes) || (rt === RelationType.DEFINED);
    })
    .map(x => {
      return {
        page: x[1].target,
        relationType: x[1].parentType,
        typeDefinition: x[1].parentTypeDefinition,
        linkDirection: x[1].direction
      }
    });//.sort
  }

  isFriend (relation: Relation):RelationType {
    const {pi,pd,ci,cd,fd} = getRelationVector(relation);
    return fd 
      ? RelationType.DEFINED 
      : (pi && !pd && ci && !cd && !fd)
        ? RelationType.INFERRED
        : null;
  }
    

  hasFriends():boolean {
    return this.getNeighbours()
    .some(x => {
      const rt = this.isFriend(x[1]);
      return (rt && this.settings.showInferredNodes) || (rt === RelationType.DEFINED);
    })
  }

  getFriends():Neighbour[] {
    return this.getNeighbours()
    .filter(x => {
      const rt = this.isFriend(x[1]);
      return (rt && this.settings.showInferredNodes) || (rt === RelationType.DEFINED);
    })
    .map(x => {
      return {
        page: x[1].target,
        relationType: x[1].friendType ??
          (x[1].parentType === RelationType.DEFINED && x[1].childType === RelationType.DEFINED)
          //case H
          ? RelationType.DEFINED
          //case I
          : RelationType.INFERRED,
        typeDefinition: x[1].friendTypeDefinition,
        linkDirection: x[1].direction
      }
    });//.sort
  }
  

  getRelationToPage(otherPage:Page):null|{
    type: "friend" | "parent" | "child",
    relationType: RelationType;
    typeDefinition: string,
  } {
    const relation = this.neighbours.get(otherPage.path)
    if(!relation) {
      return null;
    }
    if(this.isChild(relation)) {
      return {
        type: "child",
        relationType: relation.childType,
        typeDefinition: relation.childTypeDefinition
      }
    }
    if(this.isParent(relation)) {
      return {
        type: "parent",
        relationType: relation.parentType,
        typeDefinition: relation.parentTypeDefinition
      }
    }
    else return {
      type: "friend",
      relationType: relation.friendType,
      typeDefinition: relation.friendTypeDefinition
    }
  }

  getSiblings():Neighbour[] {
    const siblings = new Map<string,Neighbour>();
    this.getParents().forEach(p => 
      p.page.getChildren().forEach(s => {
        if(siblings.has(s.page.path)) {
          if(s.relationType === RelationType.DEFINED) {
            siblings.get(s.page.path).relationType = RelationType.DEFINED;
          }
          return;
        }
        siblings.set(s.page.path,s);
      })
    );
    return Array.from(siblings.values());
  }
}