#include <iostream>
#include <vector>
#include <algorithm>
#include <iterator>
void print(const std::vector<int>& v){for(std::size_t i=0;i<v.size();++i)std::cout<<(i?" ":"")<<v[i];std::cout<<'\n';}
int main(){
 std::vector<int> a{1,2,2,4},b{2,3},out;
 std::set_union(a.begin(),a.end(),b.begin(),b.end(),std::back_inserter(out));print(out);out.clear();
 std::set_intersection(a.begin(),a.end(),b.begin(),b.end(),std::back_inserter(out));print(out);out.clear();
 std::set_difference(a.begin(),a.end(),b.begin(),b.end(),std::back_inserter(out));print(out);out.clear();
 std::set_symmetric_difference(a.begin(),a.end(),b.begin(),b.end(),std::back_inserter(out));print(out);
 std::cout<<std::includes(a.begin(),a.end(),b.begin(),b.end())<<'\n';
}
